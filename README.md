# 🎾 Padel & Tennis Match Master PRO
**Aplikasi Penghitung Skor Pertandingan, Sistem Turnamen & Bagan, Profil Pemain dengan Foto, dan Sinkronisasi Google Sheets.**

Aplikasi ini dibuat khusus untuk menyelesaikan permasalahan mengingat skor atau mencatat di kertas saat bermain tenis atau padel bersama rekan-rekan. Dirancang dengan tampilan mobile-friendly responsif berstandar turnamen internasional yang dapat dioperasikan langsung dari smartphone, tablet, laptop, atau layar TV lapangan.

---

## 🌟 Fitur Utama

### 1. 🎾 Papan Skor Langsung Lapangan (Live Courtside Scoring)
- **Perhitungan Skor Resmi Tennis & Padel**:
  - Skor poin standar: `0 (Love) -> 15 -> 30 -> 40 -> Deuce -> Advantage (AD) -> Game`.
    - **🏆 Kemenangan W.O. / Diskualifikasi / Cedera**:
    - Tombol khusus **"🏆 Menang W.O. / Diskualifikasi"** di action bar.
    - Opsi alasan: **Diskualifikasi (DQ)**, **Walkover (W.O. - lawan tidak hadir/terlambat)**, atau **Mundur karena Cedera (RET)**.
    - Otomatis mencatat status kemenangan dan menyuarakan wasit.
  - **Dua Mode Perebutan Poin 40-40**:
    - **🎾 Mode Deuce Standar (Advantage)**: Harus menang selisih 2 poin (40-40 -> AD -> Game, atau AD -> 40-40 Deuce).
    - **⭐ Mode Golden Point (Punto de Oro / No-Ad)**: 1 poin penentu pemenang game langsung. Bisa di-switch kapan saja via tombol di layar skor!
  - **Sistem Tie-break & Super Tie-break**: Otomatis aktif saat skor game seimbang pada target set.
- **🏟️ Tiga lapangan dengan skor bersama**
  - Pilih Lapangan 1, 2, atau 3 dari HP mana pun. Setiap lapangan kosong sampai seseorang membuat pertandingan.
  - Satu pertandingan aktif per lapangan. Pertandingan di lapangan lain bisa berjalan bersamaan.
  - Panel Pemain, Panel Admin, dan Pantau Lapangan menampilkan pertandingan dari database yang sama. Skor pada layar perangkat lain diperbarui otomatis.
  - **Selesaikan & Simpan Match** mencatat hasil, memajukan bagan bila berlaku, lalu mengosongkan lapangan. Untuk mengakhiri lebih awal, pilih pemenangnya.
- **Fleksibilitas Mini Game & Jumlah Game per Set**:
  - Pilihan jumlah game per set bebas: **1 Game (Mini / Sudden Death)**, **2 Game**, **3 Game (Fast Mini Set)**, **4 Game (Short Set)**, **6 Game (Standar Resmi)**, hingga opsi **Kustom (Angka Bebas)**.
  - Target game dapat diubah langsung saat pertandingan berjalan tanpa perlu me-reset skor.
- **Dukungan Penuh Nomor Ganda (Doubles 2v2 - 4 Pemain)**:
  - Input 4 pemain lengkap: Pemain A1, A2 vs Pemain B1, B2.
  - Tampilan dual avatar di papan skor untuk kedua tim dan nama pasangan.
  - **Rotasi & Pemilihan Servis Ganda**: Indikator servis aktif perorangan dan tombol cepat ganti server.
- **Fitur Pintar Wasit**:
  - **Pengingat Pindah Lapangan (Change Sides)**: Muncul notifikasi otomatis setiap jumlah game ganjil dan kelipatan 6 poin tie-break.
  - **Undo Poin**: Batalkan kesalahan klik poin tanpa merusak jalannya pertandingan.
  - **Wasit Bersuara (Voice Umpire)**: Suara otomatis mengumumkan skor ("Lima Belas - Kosong", "Deuce!", "Keuntungan Tim A", "Game Tim A").
  - **Mode Lapangan Terang (Outdoor Sunlight ☀️)**: Mode kontras tinggi di bawah terik sinar matahari.

### 2. 🏆 Sistem Turnamen, Bagan Visual & Kustom Bagan
- **Pilih Semua Peserta (Select All / Deselect All)**:
  - Tombol **"☑️ Pilih Semua"** dan **"⬜ Batal Semua"** saat memilih pemain tunggal dalam pembuatan turnamen.
- **Mendukung Turnamen Tunggal & Ganda**:
  - **Pembentukan Pasangan Tim Ganda**: Fitur pembentuk tim ganda sebelum turnamen dimulai. Pengguna dapat memilih Pemain 1 + Pemain 2 untuk tiap tim, atau menggunakan tombol **"🎲 Pasangkan Otomatis"** untuk membuat tim ganda secara instan dari database pemain!
- **Bagan Gugur (Knockout Tree)**:
  - Menampilkan visual bagan pohon pertandingan dengan dual avatar pasangan tim ganda.
  - **Keterangan Skor & Status W.O./DQ di Tiap Match**: Tiap kotak match menampilkan skor akhir atau badge khusus jika menang karena diskualifikasi (`W.O. (Diskualifikasi)` / `W.O. (Tidak Hadir)`).
  - Tombol cepat **W.O./DQ** langsung dari bagan jika lawan tidak hadir sebelum match dimulai.
  - Pemenang otomatis maju ke babak berikutnya (*Quarter -> Semi -> Final*).
- **🔄 Tukar Posisi Peserta (Custom Bracket Seeding)**:
  - Jika peserta me-request untuk pindah jadwal atau lawan, wasit dapat menggunakan tombol **"⚙️ Tukar Posisi Peserta"**.
  - Pilih Peserta 1 dan Peserta 2 di Babak 1 untuk saling bertukar posisi secara instan!
  - Dilengkapi tombol **"🎲 Acak Ulang Seluruh Bagan"** jika panitia ingin mengocok ulang susunan babak pertama.
- **Round Robin (Setengah Kompetisi)**:
  - Klasemen otomatis menghitung Main, Menang, Kalah, Selisih Set, Selisih Game, dan Poin.

### 3. 👥 Manajemen Pemain & Rekam Voice Slogan Kemenangan
- Tambah dan edit profil rekan bermain.
- **Upload Foto Pemain**: Langsung dari file gambar atau jepretan kamera HP, lengkap dengan preview avatar.
- **🎙️ Perekaman Suara Slogan Kemenangan (Voice Slogan)**:
  - Setiap pemain dapat merekam slogan atau yel-yel kemenangan dengan mikrofon HP/laptop via tombol **"🎙️ Rekam Suara"** (MediaRecorder) atau upload audio file.
  - Teks slogan dan audio tersimpan di profil pemain.
  - **Diputar Otomatis Saat Menang**: Ketika pertandingan berakhir, sistem akan merayakan kemenangan dengan confetti dan memutar audio rekaman slogan juara asli sang pemenang!
  - Tombol **"▶️ Putar Ulang Suara"** untuk mendengarkan kembali slogan selebrasi.
- Catat nama lengkap, nama panggilan/alias, tangan dominan (Kanan/Kidal), dan level permainan (*Beginner, Intermediate, Advanced, Pro*).
- Statistik karier: Total main, total menang, total kalah, dan grafik persentase kemenangan (*Win Rate %*).

### 4. 📊 Integrasi Google Sheets & Ekspor Data
- **Sinkronisasi Otomatis ke Google Sheets**:
  - Setiap pertandingan selesai, data langsung dikirim ke Google Sheet Anda secara real-time!
  - Otomatis membuat 3 sheet terpisah yang rapi:
    1. `Pertandingan`: Rekap tanggal, pemain, skor per set, pemenang, format aturan, durasi main.
    2. `Klasemen_Pemain`: Rekap statistik seluruh pemain beserta persentase kemenangan.
    3. `Turnamen`: Rekap turnamen dan sang juara.
- **Ekspor Excel (.xlsx) & CSV**:
  - 1-Klik tombol download laporan lengkap format `.xlsx` dan `.csv`.

---

## Deploy ke Cloudflare Pages

Gunakan `dfscoring123-static-deploy.zip` di project Direct Upload `dfscoring123`. Database `df-scoring` sudah terhubung ke Production melalui binding `DF_SCORING_DB`. Worker membuat tabel yang dibutuhkan saat pertama kali dijalankan. Untuk project baru, buat dan pasang binding D1 yang sama sebelum mengunggah ZIP.

1. Di **Workers & Pages → dfscoring123 → Settings → Production → Variables and secrets**, tambahkan `DF_ADMIN_PASSWORD` dengan tipe **Secret**. Masukkan password bersama untuk semua admin. Admin bisa memakai nama masing-masing. Akun email dan Google bisa masuk setelah database terhubung, meskipun secret admin belum diisi.
2. Untuk menyalakan **Masuk Google**, buat OAuth Client ID bertipe **Web application** di Google Auth Platform. Daftarkan `https://dfscoring123.pages.dev` di **Authorized JavaScript origins** dan pilih audience **External**. Login ini hanya meminta `openid`, email, dan profil dasar. Menurut [aturan audience Google](https://support.google.com/cloud/answer/15549945?hl=en), Sign in with Google dengan cakupan dasar ini dapat dipakai tanpa daftar test user meskipun status OAuth masih Testing. Pakai Client ID sebagai variable `GOOGLE_CLIENT_ID` di Cloudflare atau isi **Google OAuth Client ID** di panel Pengaturan. Pengaturan Cloudflare didahulukan jika keduanya diisi. Alur ini hanya menggunakan Client ID.
3. Buka **Create deployment**, pilih **Production**, lalu unggah ZIP. Untuk deploy lewat Wrangler, gunakan output `static` dan database D1 yang tertera di `wrangler.toml`. Production perlu deployment baru agar binding dan perubahan variable dari dashboard aktif.
4. Masuk ulang dari dua HP di URL Pages yang sama. Coba daftar dengan email dan password, login admin, serta tombol Google jika Client ID sudah aktif. Buat match di Lapangan 3, ubah skor di satu HP, lalu cek dan selesaikan dari HP lain.

Jika deployment lama memakai KV, pasang binding `DF_SCORING_KV` sebelum D1 pertama kali diakses agar pemain, riwayat, turnamen, dan pengaturan yang tersimpan di KV ikut disalin. Data dari cache deployment lama dapat dipulihkan melalui **Backup JSON** versi lama dan **Restore** pada versi baru. Tiga lapangan mulai kosong. Sesi lama memerlukan login ulang. Akun email baru memiliki password tersendiri. Akun yang dulu hanya dibuat dengan mengisi nama dan alamat email perlu mendaftar sekali atau masuk melalui Google.

Referensi [binding Cloudflare D1](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases), [unggah ZIP](https://developers.cloudflare.com/pages/get-started/direct-upload/), dan [penyiapan Google Identity Services](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## Jalankan di komputer

Gunakan Node.js 24 atau lebih baru. Jalankan `start.bat` atau `python app.py`, lalu buka `http://localhost:8000`. Jika ingin menguji login admin, buat file lokal `.dev.vars` berisi `DF_ADMIN_PASSWORD=PASSWORD_LOKAL_ANDA`. Untuk menguji Google, tambahkan `GOOGLE_CLIENT_ID` dan daftarkan origin lokal pada OAuth client. Untuk menguji dari dua HP di jaringan Wi-Fi yang sama, gunakan alamat IP komputer pada port 8000. Server lokal menjalankan Worker yang sama dengan SQLite di `.wrangler/local-scoring.sqlite` dan mengimpor data lama dari `data/` saat pertama dijalankan.

Jalankan `node --test tests/shared-scoring.test.mjs` untuk memeriksa autentikasi, sinkronisasi dua sesi, konflik skor, penyelesaian match, dan turnamen. Jalankan `python tools/package_pages.py --check` untuk membuat ulang ZIP setelah mengubah source dan menguji Worker yang benar-benar ada di dalam paket.

## 📋 Panduan Menghubungkan ke Google Sheets (1-2 Menit)

1. Buka browser dan kunjungi [sheet.new](https://sheet.new) untuk membuat Google Spreadsheet baru.
2. Di Google Sheet tersebut, klik menu **Extensions (Ekstensi)** &gt; **Apps Script**.
3. Hapus kode default yang ada di dalam editor Apps Script.
4. Buka file `google_apps_script.js` pada folder aplikasi ini, **salin seluruh isinya**, lalu tempelkan (paste) ke editor Apps Script.
5. Klik ikon **Save** (Simpan 💾).
6. Di pojok kanan atas, klik tombol biru **Deploy** &gt; pilih **New deployment**.
7. Klik ikon gerigi (Select type) &gt; pilih **Web app**.
8. Isi konfigurasinya:
   - **Description**: `Padel Tennis Scoring`
   - **Execute as**: `Me (email Anda)`
   - **Who has access**: `Anyone` *(Penting agar aplikasi dapat mengirim data tanpa login ulang)*
9. Klik **Deploy** dan setujui izin akses (*Review permissions* &gt; pilih akun Google Anda &gt; *Advanced* &gt; *Go to Untitled (unsafe)* &gt; *Allow*).
10. Salin **Web app URL** yang muncul (yang berakhiran `/exec`).
11. Buka aplikasi **Padel & Tennis Master** &gt; Masuk ke tab **Google Sheet & Setup** &gt; Tempelkan URL tersebut ke kolom **Google Apps Script Webhook URL** &gt; Klik **Simpan Pengaturan**.
12. Klik tombol **Test Koneksi** untuk memastikan statusnya telah terhubung (*Berhasil*).

Selamat bertanding! 🎾🏆
