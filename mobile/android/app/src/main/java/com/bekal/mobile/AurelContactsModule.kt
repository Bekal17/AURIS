package com.bekal.mobile

import android.content.ContentResolver
import android.database.Cursor
import android.provider.ContactsContract
import com.facebook.react.bridge.*

class AurelContactsModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AurelContactsModule"

    @ReactMethod
    fun findContact(name: String, promise: Promise) {
        try {
            val contentResolver: ContentResolver = reactContext.contentResolver
            val cursor: Cursor? = contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    ContactsContract.CommonDataKinds.Phone.NUMBER
                ),
                "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?",
                arrayOf("%$name%"),
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME
            )
            val contacts = Arguments.createArray()
            cursor?.use {
                while (it.moveToNext()) {
                    val contactName = it.getString(0) ?: continue
                    val phoneNumber = it.getString(1) ?: continue
                    val contact = Arguments.createMap()
                    contact.putString("name", contactName)
                    contact.putString("phone", phoneNumber.replace(" ", "").replace("-", ""))
                    contacts.pushMap(contact)
                }
            }
            promise.resolve(contacts)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }
}
