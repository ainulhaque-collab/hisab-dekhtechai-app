package com.hisabdekhtechai.app;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Bundle;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import org.json.JSONArray;
import org.json.JSONObject;

/** Opt-in instrumentation only. READONLY SQLite; no Activity, JS, network,
 * credentials, financial mutations or raw customer records in its output. */
public final class UpgradeStorageProbe {
    private static String canonical(Object value) throws Exception {
        if (value == null || value == JSONObject.NULL) return "null";
        if (value instanceof JSONObject) {
            JSONObject object=(JSONObject)value;
            ArrayList<String> keys=new ArrayList<>();
            object.keys().forEachRemaining(keys::add); Collections.sort(keys);
            StringBuilder out=new StringBuilder("{");
            for(String key:keys){if(out.length()>1)out.append(',');out.append(JSONObject.quote(key)).append(':').append(canonical(object.get(key)));}
            return out.append('}').toString();
        }
        if (value instanceof JSONArray) {
            JSONArray array=(JSONArray)value;StringBuilder out=new StringBuilder("[");
            for(int i=0;i<array.length();i++){if(i>0)out.append(',');out.append(canonical(array.get(i)));}
            return out.append(']').toString();
        }
        return value instanceof String?JSONObject.quote((String)value):value.toString();
    }
    private static String hash(Object value) throws Exception {
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(canonical(value).getBytes(StandardCharsets.UTF_8));
        StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();
    }
    public static Bundle read(Context context) throws Exception {
        File source=context.getDatabasePath("hisab_dekhtechai_dbSQLite.db");
        if(!source.isFile())throw new Exception("UPGRADE_STORAGE_MISSING");
        try(SQLiteDatabase db=SQLiteDatabase.openDatabase(source.getPath(),null,SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS);
            Cursor cursor=db.rawQuery("SELECT value FROM durable_kv WHERE key = ?",new String[]{"hisab_dekhtechai_db"})){
            if(!cursor.moveToFirst())throw new Exception("UPGRADE_SNAPSHOT_MISSING");
            JSONObject snapshot=new JSONObject(cursor.getString(0)),finance=new JSONObject(),outbox=new JSONObject();
            Bundle result=new Bundle();
            for(String key:new String[]{"workspaces","accounts","accountGroups","accountPermissions","categories","parties","journalTransactions","journalLines","budgets","recurringRules","recurringOccurrences","receiptBlobs","preferences"}){
                JSONArray entries=snapshot.optJSONArray(key);if(entries==null)entries=new JSONArray();
                finance.put(key,entries);result.putInt(key+"_count",entries.length());
            }
            finance.put("localIdentity",snapshot.opt("localIdentity"));
            for(String key:new String[]{"syncOperations","syncOutbox","appliedOperations","conflicts"}){
                JSONArray entries=snapshot.optJSONArray(key);if(entries==null)entries=new JSONArray();
                outbox.put(key,entries);result.putInt(key+"_count",entries.length());
            }
            result.putInt("schema_version",snapshot.getInt("schemaVersion"));
            result.putString("finance_sha256",hash(finance));result.putString("outbox_sha256",hash(outbox));
            result.putString("upgrade_storage_status","PASS");return result;
        }
    }
}
