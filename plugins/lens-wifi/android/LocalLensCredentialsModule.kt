package com.anonymous.annyv4.lenswifi

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.*
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Pairing secret encrypted with an app-specific, non-exportable Android key. */
class LocalLensCredentialsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "LocalLensCredentials"
    private val prefs = context.getSharedPreferences("local_lens_pairing", 0)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "anny_local_lens_pairing_v1"
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @ReactMethod fun set(value: String, promise: Promise) {
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            val saved = prefs.edit().putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                .putString("data", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()
            if (!saved) throw IllegalStateException()
            promise.resolve(null)
        } catch (_: Exception) { promise.reject("PAIRING_STORAGE", "No se pudo guardar la vinculación segura") }
    }
    @ReactMethod fun get(promise: Promise) {
        try {
            val data = prefs.getString("data", null)
            if (data == null) { promise.resolve(null); return }
            val iv = Base64.decode(prefs.getString("iv", ""), Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv)) }
            promise.resolve(String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8))
        } catch (_: Exception) { promise.reject("PAIRING_STORAGE", "Volvé a vincular los lentes") }
    }
    @ReactMethod fun clear(promise: Promise) { prefs.edit().clear().apply(); promise.resolve(null) }
}
