package com.tbox.plugins.wechatpay;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import com.tencent.mm.opensdk.constants.ConstantsAPI;
import com.tencent.mm.opensdk.modelbase.BaseReq;
import com.tencent.mm.opensdk.modelbase.BaseResp;
import com.tencent.mm.opensdk.openapi.IWXAPIEventHandler;

/** Subclass must reside at {applicationId}.wxapi.WXPayEntryActivity. No intent-filter. */
public class WechatPayCallbackActivity extends Activity implements IWXAPIEventHandler {
    @Override public void onCreate(Bundle state) { super.onCreate(state); handle(getIntent()); }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); handle(intent); }
    private void handle(Intent intent) {
        try {
            if (!WechatPaySession.configured(this) || !WechatPaySession.api(this).handleIntent(intent, this)) finish();
        } catch (RuntimeException ignored) { finish(); }
    }
    @Override public void onReq(BaseReq req) { finish(); }
    @Override public void onResp(BaseResp resp) {
        if (resp.getType() == ConstantsAPI.COMMAND_PAY_BY_WX) {
            WechatPayPlugin.result(resp.errCode); // Hint only; cannot settle an order.
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch != null) { launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP); startActivity(launch); }
        }
        finish();
    }
}
