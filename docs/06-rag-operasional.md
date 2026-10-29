# RAG operasional versi 0.2

Tanggal: 28 Oktober 2026. Status implementasi: pipeline dan sumber pilot tersedia; jalur utama Ollama berjalan lokal dan gratis, jalur OpenAI tetap opsional. Pengujian dengan transport tiruan tidak disamakan dengan keberhasilan provider asli.

## Keputusan implementasi

Model yang sudah dilatih digunakan melalui API. Proyek ini tidak melatih model dasar atau melakukan fine-tuning. Provider default Ollama dengan model jawaban `qwen2.5:3b-instruct` dan embedding `bge-m3`, keduanya dapat diubah melalui `.env`. Jalur Ollama menyusun klaim bersumber dari kutipan dan turun ke pemilihan ID kutipan bila keluarannya tidak lolos skema; jalur OpenAI memakai `gpt-5.4-mini` dan `text-embedding-3-small`.

## Koleksi awal yang diperiksa

| Sumber | Cakupan yang dapat didukung |
| --- | --- |
| Pengertian metadata pada halaman portal | Definisi dan tiga jenis metadata |
| Metadata penanganan sampah | Konsep, definisi, rumus, interpretasi, satuan dan catatan pembaruan |
| Metadata kinerja perangkat daerah | Konteks indikator historis; sumber menyatakan tidak menjadi indikator kegiatan sejak 2025 |
| CSV penanganan sampah Kota Depok | Lima observasi tahunan 2021–2025, satuan persen |

URL dan hash konten tercantum pada `data/reviewed-public-sources.json`. Pemeriksaan dilakukan terhadap salinan HTML/CSV publik dan normalisasi yang dihasilkan; bukan pengesahan statistik oleh instansi. Metadata organisasi pemuda dan balai penyuluh belum diaktifkan sebagai bukti jawaban karena kelengkapan/konteks sumber perlu diperiksa lebih lanjut.

CSV publik menggunakan titik koma sebagai pemisah dan koma desimal. Parser khusus mengubahnya menjadi format kanonik, mempertahankan urutan dan nomor baris. Nama indikator dinormalisasi dari kolom Konsep pada metadata, sedangkan judul asli dan lokasi berkas dipertahankan pada provenance.

## Pertanyaan teks

1. Ambil kandidat dari BM25 dengan filter status koleksi dan cakupan yang diketahui.
2. Bila model embedding terkonfigurasi dan indeks tersedia, ambil kandidat semantik dengan cosine similarity. Gabungkan peringkat memakai Reciprocal Rank Fusion.
3. Kirim potongan relevan ke LLM: Ollama lokal menyusun klaim bersumber (dengan cadangan pemilihan ID kutipan), atau OpenAI menyusun klaim. Materi sumber diperlakukan sebagai data; model tidak memiliki alat untuk mengakses filesystem, mengambil URL, atau mengeksekusi perintah.
4. Minta output JSON yang mengikuti schema: status, klaim, ID bukti, dan kutipan pendukung.
5. Periksa ID terhadap hasil retrieval, kecocokan kutipan asli, angka dalam kutipan, serta status sumber setelah panggilan selesai.
6. Buat URL dan nomor rujukan dari katalog backend. Jika hasil gagal diperiksa, tampilkan kutipan lokal dengan pemberitahuan.

Validasi ini memeriksa rujukan secara mekanis. Ia belum membuktikan seluruh makna klaim benar, sehingga evaluasi manusia dan perluasan pertanyaan acuan tetap diperlukan.

## Pertanyaan angka

Angka dibaca dari observasi CSV yang telah diperiksa, bukan dari tebakan LLM. Indikator, tahun, wilayah dan satuan harus sesuai. Permintaan tahun di luar tabel atau wilayah berbeda tidak diisi dengan perkiraan. “Terbaru” berarti periode paling tinggi yang sesuai dalam koleksi, bukan jaminan terbaru di seluruh portal.

Pertanyaan lanjutan singkat, misalnya “Kalau 2024?”, memakai konteks pertanyaan sebelumnya. Pertanyaan eksplisit dengan topik baru memulai pencarian sendiri. Pengelolaan konteks ini terbatas; belum merupakan pemahaman percakapan bebas untuk seluruh variasi bahasa.

## Konfigurasi dan status

Kunci API hanya berada di `.env`/environment server; jalur Ollama tidak memerlukan kunci. Browser menerima boolean konfigurasi, nama provider/model, ukuran indeks dan hasil panggilan, tanpa nilai kunci. Perubahan `.env` dibaca ulang pada permintaan selanjutnya.

Pada workspace tersedia:

- Ambil sumber publik terkurasi: sumber baru tetap menunggu pemeriksaan.
- Bangun indeks embedding: hanya potongan yang belum memiliki indeks provider/model aktif yang diproses.
- Uji RAG dengan model: membangun indeks publik dan menguji pertanyaan rumus sampah.
- Diagnostik jumlah observasi, indeks serta status panggilan terakhir.

CLI `npm.cmd run rag:activate` menjalankan dua jawaban berbantuan model, satu pembacaan angka dan satu kasus bukti tidak tersedia. Laporan sukses harus memiliki `ok: true`; keberhasilan fallback bukan bukti LLM berfungsi. Untuk kedua provider, uji ini menuntut `mode: generated`; Ollama boleh turun ke `model-assisted` saat runtime bila keluarannya tidak lolos skema, tetapi fallback itu tidak dihitung lulus oleh skrip.

## Batas operasional

Belum ada autentikasi workspace, hosting publik, impor PDF/XLSX, crawler menyeluruh, sinkronisasi berkala, atau perhitungan lintas baris. Koleksi empat sumber masih pilot dan tidak mencakup semua dataset portal. Sumber yang berubah perlu ditinjau lagi; persetujuan berdasarkan hash tidak otomatis berlaku untuk konten baru.
