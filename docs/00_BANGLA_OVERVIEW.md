# Hisab DekhteChai (হিসাব দেখতে চাই) — ডেভেলপমেন্ট প্যাকেজের বাংলা সারাংশ

**এটি অ্যাপের সোর্স কোড নয়।** আপনার Coding Agent যাতে সম্পূর্ণ কার্যকর অ্যাপ তৈরি করতে পারে, তার জন্য বিস্তারিত প্রয়োজনীয়তা, প্রযুক্তিগত নকশা, কাজের ক্রম ও পরীক্ষার ডকুমেন্ট।

## আমরা কী তৈরি করব?
- প্রথমে **Android App**, সেটি সম্পূর্ণ তৈরি, পরীক্ষা, Google Drive Sync যাচাই ও রিলিজ প্রস্তুত হওয়ার পরে **Web App**।
- Android-এ **সম্পূর্ণ Offline হিসাব**: আয়, ব্যয়, টাকা স্থানান্তর, ক্যাটাগরি, লেজার, অ্যাকাউন্ট, রিপোর্ট, বাজেট, রিকারিং ও দরকারি অন্যান্য কাজ।
- প্রথমবার **Continue with Google** → Google Drive-এর প্রয়োজনীয় অনুমতি → এরপর স্বাভাবিক ব্যবহার। গ্রাহককে API Key বা Recovery Key দিতে হবে না।
- ইন্টারনেট থাকলে বা ফিরে এলে গ্রাহকের **নিজস্ব Google Drive**-এর মাধ্যমে Android ও পরবর্তীতে Web-এর মধ্যে **Automatic Two-Way Sync**। এটি তাৎক্ষণিক Live Sync নয়; নেটওয়ার্ক/Google-এর অনুমতি ও ডিভাইসের সীমাবদ্ধতা অনুযায়ী সম্পন্ন হবে।
- Supabase, Firebase Database, আলাদা অনলাইন হিসাব সার্ভার এবং Windows Native App থাকবে না।
- অ্যাপ আপডেট করার সময় SQLite Data, অনলাইন না হওয়া হিসাব, Sync Queue এবং পুরোনো Ledger অক্ষত রাখার **নিরাপদ Migration ও Recovery ব্যবস্থা** থাকবে।
- **Minimal Blue & White** ডিজাইন, একই ধরনের Outline Icons, বাংলা ভাষা প্রধান।

## Coding Agent কীভাবে কাজ করবে?
1. `00_README_START_HERE.md` পড়বে, তারপর 01–13 ডকুমেন্ট অনুসরণ করবে।
2. Android Repository, UI, SQLite ও সঠিক Accounting Engine তৈরি করবে।
3. Google Login এবং গ্রাহকের নিজের Drive-এর Sync বাস্তবে যুক্ত করবে।
4. দুই ফোনে অফলাইন হিসাব যোগ করে পরে Sync-এর পরীক্ষা করবে—ডুপ্লিকেট বা হারানো ডেটা চলবে না।
5. পুরোনো অ্যাপ ভার্সন আপডেট, Recovery, Storage Full, Wrong Google Account ও Crash Test করবে।
6. Android Production-Ready Build, QA Evidence ও Play Store Release Checklist প্রস্তুত করবে।
7. Android পর্যায় সফল হওয়ার পর Web App-এর কাজ শুরু করবে।

## গ্রাহকের অভিজ্ঞতা
`অ্যাপ ইনস্টল → Continue with Google → Drive অনুমতি → Dashboard → Offline আয়/ব্যয় → স্থানীয়ভাবে সেভ → অনলাইন হলে Drive Auto Sync → অন্য ডিভাইসে একই Google Account দিয়ে হিসাব পাওয়া`।

## গুরুত্বপূর্ণ নিরাপত্তার সত্যতা
- কোনো অ্যাপ ১০০% ডেটা সুরক্ষার নিশ্চয়তা দিতে পারে না; তাই নিরাপদ Local Database, Versioned Cloud Backup, Crash Recovery ও পরীক্ষার ব্যবস্থা জরুরি।
- **Recovery Key ছাড়া V1-এ Zero-Knowledge বা End-to-End Encryption দাবি করব না**। Google-এর নিরাপত্তা, সীমিত Drive অনুমতি, HTTPS এবং ডিভাইসের নিজস্ব সুরক্ষা ব্যবহার করব।
- গ্রাহক ইন্টারনেট ছাড়া নতুন ডিভাইসে প্রথম Google Sign-in করতে পারবেন না। পুরোনো সেটআপ করা Android ডিভাইসে অফলাইনে কাজ পারবেন।
- Google Drive-এ Sync না হওয়া হিসাব যদি ফোন নষ্ট হওয়ার আগে আপলোড না হয়, নতুন ফোনে সেটি উদ্ধার নাও হতে পারে। অ্যাপ Pending Sync সতর্কতা দেখাবে।
- এক Google মালিকের Personal ও Business Workspace প্রথম ভার্সনে থাকবে। একাধিক কর্মীর শেয়ার করা হিসাব ও Approval System ভবিষ্যতে আলাদা নিরাপত্তা ব্যবস্থা ছাড়া চালু করা হবে না।

## বর্তমানে কাজের অবস্থা
ডকুমেন্ট প্রস্তুত। Android অ্যাপের কোড, বাস্তব Google OAuth/Drive Integration, APK/AAB Build, Tester Verification, Web App বা Play Store Publish এই ডকুমেন্ট তৈরি করার অংশ হিসেবে করা হয়নি। Coding Agent-কে এসব প্রকৃতপক্ষে বাস্তবায়ন ও পরীক্ষা করতে হবে।
