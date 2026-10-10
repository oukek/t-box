package com.tbox.plugins.nativescanner;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.zxing.client.android.Intents;
import com.google.zxing.BarcodeFormat;
import com.journeyapps.barcodescanner.ScanOptions;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(
    name = "NativeScanner",
    permissions = {
        @Permission(alias = NativeScannerPlugin.CAMERA_PERMISSION, strings = { Manifest.permission.CAMERA })
    }
)
public class NativeScannerPlugin extends Plugin {
    static final String CAMERA_PERMISSION = "camera";

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", true);
        call.resolve(result);
    }

    @PluginMethod
    public void scan(PluginCall call) {
        if (getPermissionState(CAMERA_PERMISSION) != PermissionState.GRANTED) {
            requestPermissionForAlias(CAMERA_PERMISSION, call, "onCameraPermissionResult");
            return;
        }
        startScan(call);
    }

    @PermissionCallback
    private void onCameraPermissionResult(PluginCall call) {
        if (getPermissionState(CAMERA_PERMISSION) == PermissionState.GRANTED) {
            startScan(call);
            return;
        }
        call.reject("Camera permission denied.", "CAMERA_PERMISSION_DENIED");
    }

    private void startScan(PluginCall call) {
        ScanOptions options = new ScanOptions();
        options.setDesiredBarcodeFormats(getDesiredFormats(call.getArray("formats")));
        options.setPrompt("Align the barcode inside the frame.");
        options.setBeepEnabled(false);
        options.setOrientationLocked(false);
        options.setTorchEnabled(call.getBoolean("torch", false));
        options.setCaptureActivity(NativeScannerCaptureActivity.class);

        startActivityForResult(call, options.createScanIntent(getContext()), "handleScanResult");
    }

    @ActivityCallback
    private void handleScanResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Scan canceled.", "SCAN_CANCELED");
            return;
        }

        Intent data = result.getData();
        String text = data.getStringExtra(Intents.Scan.RESULT);
        if (text == null || text.isEmpty()) {
            call.reject("No barcode value detected.", "SCAN_EMPTY");
            return;
        }

        JSObject response = new JSObject();
        response.put("text", text);
        response.put("format", data.getStringExtra(Intents.Scan.RESULT_FORMAT));
        response.put("cancelled", false);
        call.resolve(response);
    }

    private List<String> getDesiredFormats(JSArray formats) {
        List<String> desiredFormats = new ArrayList<>();

        if (formats == null || formats.length() == 0) {
            desiredFormats.add(ScanOptions.QR_CODE);
            desiredFormats.add(ScanOptions.CODE_128);
            return desiredFormats;
        }

        for (int i = 0; i < formats.length(); i++) {
            String format = formats.optString(i, "");
            String mapped = mapFormat(format);
            if (mapped != null) {
                desiredFormats.add(mapped);
            }
        }

        if (desiredFormats.isEmpty()) {
            desiredFormats.add(ScanOptions.QR_CODE);
            desiredFormats.add(ScanOptions.CODE_128);
        }

        return desiredFormats;
    }

    private String mapFormat(String format) {
        switch (format) {
            case "aztec":
                return BarcodeFormat.AZTEC.name();
            case "code_128":
                return ScanOptions.CODE_128;
            case "code_39":
                return ScanOptions.CODE_39;
            case "code_93":
                return ScanOptions.CODE_93;
            case "data_matrix":
                return ScanOptions.DATA_MATRIX;
            case "ean_13":
                return ScanOptions.EAN_13;
            case "ean_8":
                return ScanOptions.EAN_8;
            case "itf":
                return ScanOptions.ITF;
            case "pdf_417":
                return ScanOptions.PDF_417;
            case "qr_code":
                return ScanOptions.QR_CODE;
            case "upc_a":
                return ScanOptions.UPC_A;
            case "upc_e":
                return ScanOptions.UPC_E;
            default:
                return null;
        }
    }
}
