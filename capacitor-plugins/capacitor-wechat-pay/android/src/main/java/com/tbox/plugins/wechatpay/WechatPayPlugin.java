package com.tbox.plugins.wechatpay;

import java.lang.ref.WeakReference;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.tencent.mm.opensdk.modelpay.PayReq;
import com.tencent.mm.opensdk.constants.Build;
import com.tencent.mm.opensdk.openapi.IWXAPI;

@CapacitorPlugin(name = "TBoxWechatPay")
public class WechatPayPlugin extends Plugin {
    private static WeakReference<WechatPayPlugin> current = new WeakReference<>(null);
    private long pendingUntil = 0;
    @Override public void load() { current = new WeakReference<>(this); }
    @PluginMethod public void getStatus(PluginCall call) {
        boolean configured = WechatPaySession.configured(getContext());
        JSObject result = new JSObject();
        result.put("enabled", WechatPaySession.enabled(getContext()));
        result.put("configured", configured);
        result.put("appId", WechatPaySession.appId(getContext()));
        result.put("installed", configured && WechatPaySession.api(getContext()).isWXAppInstalled());
        call.resolve(result);
    }
    @PluginMethod public void pay(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!WechatPaySession.configured(getContext())) { call.reject("原生微信支付尚未配置", "NOT_CONFIGURED"); return; }
            String appId = call.getString("appId", "");
            String merchant = call.getString("partnerId", "");
            String prepay = call.getString("prepayId", "");
            String nonce = call.getString("nonceStr", "");
            String time = call.getString("timeStamp", "");
            String signature = call.getString("sign", "");
            if (!appId.equals(WechatPaySession.appId(getContext())) ||
                !merchant.matches("[0-9]{6,32}") || !prepay.matches("[A-Za-z0-9_-]{1,128}") ||
                !nonce.matches("[A-Za-z0-9_-]{1,32}") || !time.matches("[0-9]{10}") ||
                !signature.matches("[A-Za-z0-9+/]{1,1024}={0,2}") ||
                !"Sign=WXPay".equals(call.getString("packageValue"))) {
                call.reject("支付参数或移动应用 AppID 不匹配", "INVALID_PARAMETERS"); return;
            }
            if (pendingUntil > SystemClock.elapsedRealtime()) { call.reject("已有支付正在处理中，请先核对订单或稍后重试", "PAYMENT_BUSY"); return; }
            IWXAPI api = WechatPaySession.api(getContext());
            if (!api.isWXAppInstalled()) { call.reject("请先安装微信", "WECHAT_NOT_INSTALLED"); return; }
            if (api.getWXAppSupportAPI() < Build.PAY_SUPPORTED_SDK_INT) { call.reject("请更新微信后再支付", "WECHAT_UNSUPPORTED"); return; }
            PayReq req = new PayReq();
            req.appId = appId; req.partnerId = merchant; req.prepayId = prepay;
            req.packageValue = "Sign=WXPay"; req.nonceStr = nonce; req.timeStamp = time; req.sign = signature;
            pendingUntil = SystemClock.elapsedRealtime() + 120000;
            try {
                if (!api.sendReq(req)) { pendingUntil = 0; call.reject("未能调起微信，请在订单中核对结果", "LAUNCH_FAILED"); return; }
                JSObject result = new JSObject(); result.put("launched", true); call.resolve(result);
            } catch (RuntimeException error) {
                pendingUntil = 0; call.reject("调起微信失败，请在订单中核对结果", "LAUNCH_FAILED");
            }
        });
    }
    public static void result(int code) {
        WechatPayPlugin plugin = current.get();
        if (plugin == null) return; // Cold start is recovered by the server-owned pending order.
        plugin.pendingUntil = 0;
        JSObject result = new JSObject(); result.put("code", code);
        plugin.notifyListeners("paymentResult", result);
    }
    @Override protected void handleOnResume() {
        notifyListeners("foreground", new JSObject());
    }
    @Override protected void handleOnDestroy() {
        if (current.get() == this) current.clear();
    }
}
