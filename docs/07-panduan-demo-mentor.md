# Panduan demo chatbot untuk mentor

Durasi saran: 3–5 menit. Jalankan `npm.cmd start` dari folder proyek jika server belum aktif; pastikan Ollama berjalan (ikon tray) dan model `qwen2.5:3b-instruct` serta `bge-m3` sudah terpasang.

## Alur presentasi

1. Buka http://127.0.0.1:3000/ dan tunjukkan simulasi portal. Jelaskan bahwa identitas warna mengikuti portal Satu Data Depok, dan chatbot diusulkan sebagai akses tambahan untuk mencari informasi. Angka ringkasan portal bukan jumlah sumber yang dikuasai chatbot.
2. Klik **Tanya Data** di kanan bawah. Tunjukkan popup, saran pertanyaan, dan kolom tanya cepat.
3. Klik **Mulai percakapan** untuk masuk ke http://127.0.0.1:3000/chat. Tunjukkan riwayat percakapan di kiri, area percakapan di tengah, serta sumber jawaban di kanan.
4. Pilih **Koleksi publik** jika belum aktif. Ajukan: **Berapa persentase penanganan sampah di Kota Depok tahun 2025?** Contoh yang diuji menghasilkan **53,09 persen**, dibaca langsung dari observasi CSV publik dalam koleksi lokal.
5. Klik **1 sumber** atau kartu rujukannya untuk menunjukkan asal data. Tunjukkan juga **Kembali ke portal**. Pertanyaan dapat dimulai dari popup lalu dilanjutkan lewat **Buka layar penuh**, dengan riwayat yang tetap terbawa.
6. Ajukan **Apa itu metadata?** untuk menunjukkan jawaban berbentuk kalimat dengan sitasi. Jika ingin menunjukkan diagnostik, buka **Workspace → Asisten**: di sana tersedia label **Jawaban disusun model lokal** dan **Pencarian hybrid**. Model memilih kutipan lebih dulu, lalu menyusun kalimat hanya dari kutipan itu; jika penyusunan gagal, jawaban turun ke kutipan sumber.

Kalimat pembuka yang bisa digunakan:

> Ini prototipe usulan chatbot untuk membantu pengunjung Satu Data Depok bertanya dengan bahasa sehari-hari. Pengunjung dapat mulai dari popup, lalu melanjutkan ke ruang chat penuh. Jawaban didukung sumber yang sudah dipilih dan ditinjau dalam koleksi proyek.

## Batas yang perlu dijelaskan

- Ini simulasi lokal proyek magang, belum integrasi resmi dengan sistem internal Pemerintah Kota Depok.
- Koleksi masih terbatas. Sumber berstatus kandidat bukan bukti jawaban.
- Contoh angka di atas memakai pembacaan tabel, bukan hasil generasi LLM. LLM lokal Ollama memilih kutipan lalu menyusun kalimat dari kutipan tersebut. Uji 29 Oktober 2026: `generated` + `hybrid`, 4/4 kasus aktivasi lulus; uji browser live terakhir mencatat teks 3,8–14,6 detik. Saat model baru dimuat atau mesin sibuk, uji sebelumnya mencapai sekitar 34 detik.
- Pengujian alur desktop berhasil: portal → popup → chat penuh → jawaban CSV → panel sumber. Respons API HTTP 200, metode `structured`, satu rujukan, tanpa pageerror browser.

## Bahan gambar

Gambar tahap demo tersimpan di `.artifacts/demo-mentor/`:

- `01-halaman-awal.png`
- `02-popup-chatbot.png`
- `03-halaman-chat.png`
- `04-jawaban-popup.png`
- `05-chat-dengan-jawaban.png`
- `06-rujukan-sumber.png`

Hasil pemeriksaan tersimpan di `hasil-uji.json` dalam folder yang sama. Contoh riwayat yang dipakai mengambil gambar berada dalam konteks browser pengujian terpisah; browser presentasi dapat memulai percakapan sendiri.
