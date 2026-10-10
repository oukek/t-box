package com.tbox.plugins.wechatpay;

import android.content.Context;
import com.tencent.mm.opensdk.openapi.IWXAPI;
import com.tencent.mm.opensdk.openapi.WXAPIFactory;

/** Public build configuration; no merchant keys or account secrets in the app. */
public final class WechatPaySession {
    private WechatPaySession() {}
    public static String appId(Context context) { return value(context, "tbox_wechat_app_id"); }
    public static boolean enabled(Context context) { return "true".equals(value(context, "tbox_wechat_enabled")); }
    private static String value(Context context, String name) {
        int id = context.getResources().getIdentifier(name, "string", context.getPackageName());
        return id == 0 ? "" : context.getString(id);
    }
    public static IWXAPI api(Context context) {
        IWXAPI api = WXAPIFactory.createWXAPI(context.getApplicationContext(), appId(context), true);
        api.registerApp(appId(context));
        return api;
    }
    public static boolean configured(Context context) {
        return enabled(context) && appId(context).matches("wx[A-Za-z0-9]{8,30}");
    }
}
