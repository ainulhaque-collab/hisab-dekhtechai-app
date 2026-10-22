# Android SHA-1 Certificate Fingerprint Guide for Hisab DekhteChai

## ১. প্রজেক্টের বর্তমান প্রস্তুতকৃত Debug SHA-1 (রেডি-টু-ইউজ)
আপনি যদি এখনই Google Cloud Console-এ Android OAuth Client তৈরি করতে চান, তবে এটি ব্যবহার করতে পারেন:

- **Package Name:** `com.hisabdekhtechai.app`
- **SHA-1 Fingerprint:**
  ```text
  2C:E9:7A:05:D9:98:B6:6B:47:A8:E6:CF:93:BA:DE:40:BC:70:98:6B
  ```
- **SHA-256 Fingerprint:**
  ```text
  19:1B:3B:65:8D:87:01:77:16:1C:88:B4:90:49:6B:A1:E8:B9:A6:48:51:EF:82:EF:13:F0:5C:48:EB:DA:01:30
  ```

---

## ২. আপনার নিজের পিসি/ল্যাপটপ থেকে বের করার কমান্ড

### Windows (PowerShell / Command Prompt):
```powershell
keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android
```

### Mac / Linux Terminal:
```bash
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
```

---

## ৩. Android Studio থেকে সরাসরি বের করার উপায় (সবচেয়ে সহজ)
১. Android Studio-তে প্রজেক্ট ওপেন করুন।
২. ডানদিকের সাইডবারে **Gradle** ট্যাবে ক্লিক করুন।
৩. `hisabdekhtechai` -> `app` -> `Tasks` -> `android` -> **signingReport** এ ডাবল ক্লিক করুন।
৪. নিচের **Run** কনসোলে সরাসরি আপনার ডিভাইসের `SHA-1` এবং `SHA-256` প্রিন্ট হয়ে যাবে।

---

## ৪. প্রোডাকশন রিলিজ কি-স্টোর (`release-key.keystore`) এর জন্য
```bash
keytool -list -v -keystore release-key.keystore -alias hisabdekhtechai
```

---

## ৫. Google Play Console (প্লে স্টোরে পাবলিশ করার পর)
Google Play App Signing ব্যবহারের সময় গুগল নিজস্ব কি দিয়ে অ্যাপ সাইন করে। তখন:
১. Google Play Console-এ লগইন করুন।
২. আপনার অ্যাপ সিলেক্ট করে বাঁদিকের মেনু থেকে **Setup** -> **App Integrity** তে যান।
৩. **App signing key certificate** সেকশনে থাকা **SHA-1 certificate fingerprint** কপি করে Google Cloud Console-এ আরেকটি Android Client ID হিসেবে যোগ করুন।
