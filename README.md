# 🎾 Padel & Tennis Match Master PRO
**Aplikasi Penghitung Skor Pertandingan, Sistem Turnamen & Bagan, Profil Pemain dengan Foto, dan Sinkronisasi Google Sheets.**

Aplikasi ini dibuat khusus untuk menyelesaikan permasalahan mengingat skor atau mencatat di kertas saat bermain tenis atau padel bersama rekan-rekan. Dirancang dengan tampilan mobile-friendly responsif berstandar turnamen internasional yang dapat dioperasikan langsung dari smartphone, tablet, laptop, atau layar TV lapangan.

---

## 🌟 Fitur Utama

### 1. 🎾 Papan Skor Langsung Lapangan (Live Courtside Scoring)
- **Perhitungan Skor Resmi Tennis & Padel**:
  - Skor poin standar: `0 (Love) -> 15 -> 30 -> 40 -> Deuce -> Advantage (AD) -> Game`.
  - **Tombol Cepat DEUCE (40 - 40)**: Tombol instan `⚡ SET DEUCE (40-40)` untuk langsung melompat ke skor 40-40 jika terjadi deuce di lapangan.
  - **🏆 Kemenangan W.O. / Diskualifikasi / Cedera**:
    - Tombol khusus **"🏆 Menang W.O. / Diskualifikasi"** di action bar.
    - Opsi alasan: **Diskualifikasi (DQ)**, **Walkover (W.O. - lawan tidak hadir/terlambat)**, atau **Mundur karena Cedera (RET)**.
    - Otomatis mencatat status kemenangan dan menyuarakan wasit.
  - **Dua Mode Perebutan Poin 40-40**:
    - **🎾 Mode Deuce Standar (Advantage)**: Harus menang selisih 2 poin (40-40 -> AD -> Game, atau AD -> 40-40 Deuce).
    - **⭐ Mode Golden Point (Punto de Oro / No-Ad)**: 1 poin penentu pemenang game langsung. Bisa di-switch kapan saja via tombol di layar skor!
  - **Sistem Tie-break & Super Tie-break**: Otomatis aktif saat skor game seimbang pada target set.
- **🏟️ Multi-Lapangan & Multi-Device Scoring (HP 1 & HP 2 Independen)**:
  - Header dilengkapi pilihan **Lapangan 1 (HP 1)**, **Lapangan 2 (HP 2)**, dan **Lapangan 3**.
  - Wasit di Lapangan 1 menggunakan HP 1 untuk scoring Court 1.
  - Wasit di Lapangan 2 menggunakan HP 2 untuk scoring Court 2 secara bersamaan tanpa tabrakan data!
  - Tiap lapangan menyimpan statusnya masing-masing.
  - **Tombol "📺 Pantau Multi-Court"**: Menampilkan pemantau langsung (Live Monitor) multi-lapangan secara real-time dalam satu layar.
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

## 🚀 Cara Menjalankan Aplikasi

### Cara Termudah (Windows):
Cukup **klik dua kali** file:
```
start.bat
```
Browser akan otomatis terbuka dan menampilkan aplikasi di:
`http://localhost:8000`

---

### Menjalankan via Terminal / Command Prompt:
1. Pastikan Anda berada di direktori proyek:
   ```bash
   cd "d:\Padel Tennis Scoring"
   ```
2. Jalankan aplikasi dengan Python:
   ```bash
   python app.py
   ```
3. Buka browser ke:
   ```
   http://localhost:8000
   ```

---

## 📱 Cara Membuka di Smartphone / Tablet di Lapangan

Aplikasi dapat diakses oleh siapa saja di lapangan menggunakan HP masing-masing melalui jaringan Wi-Fi / Hotspot yang sama:
1. Hubungkan HP ke Wi-Fi atau Hotspot laptop Anda.
2. Buka browser HP (Chrome / Safari), lalu ketik alamat IP laptop Anda:
   ```
   http://192.168.1.3:8000
   ```
   *(Alamat IP lokal yang aktif ditampilkan di bagian atas aplikasi)*
3. Anda bisa mengoperasikan skor atau melihat pertandingan langsung dari pinggir lapangan!

---

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
