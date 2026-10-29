# Checklist presentasi mentor

Chatbot proyek memakai **Ollama lokal**, bukan akun ChatGPT atau model asisten coding. Tidak ada login yang diperlukan untuk mencoba prototipe lokal.

## Sebelum demo

- Sambungkan laptop ke listrik; tutup aplikasi berat yang tidak diperlukan.
- Pastikan Ollama berjalan dan `ollama list` memuat `qwen2.5:3b-instruct` serta `bge-m3`.
- Pastikan `.env` memakai `RAG_PROVIDER=ollama`.
- Di folder proyek, jalankan `npm.cmd start`. Biarkan terminal ini terbuka.
- Di terminal kedua, jalankan `npm.cmd run rag:activate` untuk memanaskan model dan membuktikan 4 kasus lulus. Periksa `.artifacts/rag-live-latest.json`: `ok: true`.
- Uji alur pengunjung sungguhan: `npm.cmd run test:e2e:live`. Laporan `.artifacts/live-browser-latest.json` harus `ok: true`.
- Buka http://127.0.0.1:3000/ dan http://127.0.0.1:3000/chat.
- Pilih **Koleksi publik**. Mulai percakapan baru jika perlu.

Model yang baru dimuat bisa lebih lambat. Uji terakhir pada mesin ini: metadata 14,6 detik, rumus 6,2 detik, satuan 3,8 detik, angka 3–7 milidetik. Uji sebelumnya saat mesin lebih sibuk mencapai 19–34 detik untuk teks. Kedua model berjalan di CPU pada perangkat ini; tutup aplikasi berat yang tidak diperlukan, tetapi jangan menghentikan proses pribadi tanpa menyimpan pekerjaan. Tunggu jawaban selesai sebelum mengirim pertanyaan berikutnya. Ini bukan jaminan latensi yang sama di semua perangkat.

## Urutan demo (3–5 menit)

1. Tunjukkan portal simulasi dan popup **Tanya Data**, lalu masuk ke halaman percakapan.
2. Tanya **Apa itu metadata?** — model lokal menyusun kalimat dengan rujukan, bukan sekadar template.
3. Tanya **Apa rumus persentase penanganan sampah?** — rumus berasal dari metadata yang diperiksa.
4. Tanya **Berapa persentase penanganan sampah di Kota Depok tahun 2025?** — jawaban **53,09 persen**, CSV baris 6 (termasuk header).
5. Lanjutkan **Kalau 2024?** — jawaban **39 persen**, konteks indikator dipertahankan.
6. Klik kartu sumber untuk memperlihatkan dokumen, status, dan halaman asal.
7. Tanya **Berapa jumlah penduduk Kota Depok tahun 2099?** — sistem menolak menebak angka yang tidak tersedia.

## Penjelasan singkat yang jujur

> Ini prototipe magang, bukan layanan resmi Pemkot. Koleksi pilot masih terbatas. Model lokal membantu menyusun jawaban dari bukti; angka dibaca langsung dari tabel terverifikasi. Pengguna tetap perlu memeriksa rujukan.

- `generated`: model menyusun jawaban yang lolos pemeriksaan mekanis.
- `model-assisted`: model hanya memilih kutipan; komposisi gagal dan kalimat model tidak ditampilkan.
- `extractive`: pembacaan tabel atau kutipan tanpa generasi model.
- Belum mendukung PDF/XLSX, semua dataset portal, ataupun perhitungan lintas baris.
- Validasi angka/rujukan tidak membuktikan seluruh makna jawaban benar; evaluasi manusia tetap diperlukan.

## Jika ada masalah

- **Port terpakai:** jangan menjalankan dua server sekaligus. Gunakan server yang sudah aktif, atau hentikan terminal server milik proyek sebelum memulai ulang.
- **Ollama belum siap:** buka Ollama, periksa nama model, lalu ulangi uji aktivasi. Jangan mengganti model atau mengunduh model besar menjelang demo.
- **Model tidak menjawab:** tunggu hingga batas waktu; jika fallback tampil, jelaskan bahwa yang diperlihatkan adalah kutipan sumber, bukan hasil generasi.
- **Internet mati:** pertanyaan terhadap koleksi yang sudah tersimpan dan model yang sudah terpasang tetap dapat dicoba. Membuka halaman asal atau mengambil sumber baru memerlukan internet.
- **Perlu bukti hasil sebelumnya:** screenshot di `.artifacts/live-ollama-*.png` dan laporan JSON adalah hasil uji tersimpan, bukan demo live.

## GitHub dan keamanan

Repository: https://github.com/Andikaputh/asisten-data-depok

File `.env`, API key, database laptop, raw sources, hasil uji, dan profil browser tidak diunggah. Jangan membuka server workspace ke internet; belum ada autentikasi pengelolaan multi-pengguna. Untuk menjalankan di laptop lain, ikuti langkah clone/konfigurasi, pengambilan sumber, verifikasi, dan pemasangan model di README.
