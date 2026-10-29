# Usulan Prototipe Asisten Data Publik Satu Data Depok

Tanggal: 26 Oktober 2026  
Status: draf pengajuan dari perspektif pengguna publik / peserta magang; belum diajukan dan belum disetujui pengelola.

## Ringkasan usulan

Mengembangkan prototipe chatbot berbahasa Indonesia untuk membantu masyarakat menemukan dataset, memahami istilah statistik, dan mengakses publikasi pada portal Satu Data Depok. Tahap pertama menggunakan materi publik yang telah diverifikasi atau berkas yang diberikan pengelola. Pengembangan dapat dilakukan di lingkungan terpisah tanpa akses database internal maupun pemasangan pada situs resmi.

Nama kerja: **Asisten Data Depok**. Nama ini untuk prototipe dan belum merupakan identitas layanan resmi.

## Latar belakang dan dasar pengamatan

Pengguna awam mungkin mengetahui pertanyaannya, tetapi belum mengetahui nama indikator, judul dataset, atau perangkat daerah penyedianya. Ini merupakan hipotesis kebutuhan yang perlu diuji melalui wawancara singkat dengan pengguna dan pembimbing.

Penelusuran publik pada 26 Oktober 2026 menemukan hasil terindeks untuk halaman dataset, metadata indikator/variabel, organisasi, dan produk sektoral. Hasil pencarian menampilkan publikasi seperti Profil Kesehatan Kota Depok Tahun 2024 serta Metadata Indikator dan Variabel Kota Depok Tahun 2024. Hasil tersebut bukan inventaris terbaru yang telah dikonfirmasi.

Akses langsung beranda dan satu halaman detail melalui alat penelusuran menghasilkan pesan “Request Rejected”; daftar produk juga gagal dibaca langsung. Penyebabnya belum diketahui. Pengamatan ini tidak membuktikan portal tidak bisa dibuka oleh pengguna biasa. Belum ada akses backend, API, file tabel, maupun validasi terhadap keseluruhan portal.

Rujukan awal:

- [Portal Satu Data Depok](https://satudata.depok.go.id/).
- [Contoh detail dataset penanganan sampah](https://satudata.depok.go.id/User/detail_dataset/82c267e4-9b34-45fc-afb2-74732c04bc4d): hasil terindeks memuat definisi dan satuan indikator; nilai tabel belum diverifikasi.
- [Daftar produk sektoral](https://satudata.depok.go.id/User/produk_bidangstatistik?page=1): hasil terindeks menunjukkan publikasi; ketersediaan unduhan saat ini perlu dikonfirmasi.
- [Contoh halaman organisasi Kelurahan Depok](https://satudata.depok.go.id/User/data_organisasi/e6fa09db-e69b-4f48-9ccb-23ce6e543925): kandidat sumber pencarian dataset kewilayahan.

## Tujuan dan manfaat

1. Membantu masyarakat mencari data dengan bahasa sehari-hari.
2. Menjelaskan definisi, cakupan, satuan, dan periode data dari sumber yang tersedia.
3. Mengarahkan pengguna ke halaman atau unduhan sumber agar jawaban dapat diperiksa.
4. Menghasilkan prototipe yang dapat dinilai pengelola sebelum mempertimbangkan integrasi resmi.

Keberhasilan manfaat ini akan diukur, bukan diasumsikan sudah terbukti.

## Ruang lingkup tahap pertama

| Kebutuhan pengguna | Perilaku chatbot |
| --- | --- |
| Mencari data suatu topik | Menampilkan kandidat dataset, cakupan yang diketahui, dan tautan |
| Memahami istilah indikator | Menjelaskan berdasarkan metadata beserta sumber |
| Menemukan publikasi | Menampilkan judul dan halaman sumber yang terverifikasi |
| Pertanyaan ambigu | Meminta tahun, wilayah, atau indikator yang masih kurang |
| Meminta angka yang belum tersedia | Menjelaskan keterbatasan koleksi dan menawarkan sumber terkait |

Target awal yang diusulkan: 20–30 halaman metadata dan 2–3 publikasi publik, disesuaikan dengan sumber yang benar-benar dapat diperoleh. Mulai dari satu tema yang disepakati pembimbing, misalnya kependudukan. Jumlah ini adalah target kurasi, bukan jumlah data yang sudah dikumpulkan.

Pembacaan angka, tren, perbandingan kecamatan, dan perhitungan menjadi tahap kedua setelah tersedia tabel yang telah diperiksa. Tahap pertama tidak mencakup data pribadi, data terbatas, perubahan isi portal, akses administrator, atau klaim jawaban resmi pemerintah.

## Pendekatan RAG

Retrieval-Augmented Generation (RAG) berarti sistem mencari bukti dalam koleksi sumber terlebih dahulu, lalu menyusun jawaban berdasarkan bukti tersebut. Model tidak perlu dilatih ulang untuk setiap penambahan dokumen. RAG tetap memerlukan pemeriksaan hasil pencarian dan validasi jawaban; penggunaan RAG sendiri tidak menjamin jawaban benar.

Rancangan yang diusulkan memiliki dua jalur:

1. **Teks dan metadata:** pencarian gabungan kata kunci dan kemiripan makna, dilanjutkan pemilihan bukti dan jawaban bersumber.
2. **Tabel statistik:** pemilihan dataset, tahun, wilayah, dan satuan secara terstruktur; angka dibaca atau dihitung oleh kode yang dibatasi. Model hanya menjelaskan hasil yang sudah diperoleh.

Dasar konsep: [paper RAG oleh Lewis dkk.](https://arxiv.org/abs/2005.11401). Rancangan implementasi lebih rinci tersedia pada `02-desain-rag.md`.

## Sumber data dan cara memperoleh

Urutan yang disarankan:

1. Kurasi manual halaman dan berkas yang memang tersedia untuk publik.
2. Minta daftar tautan atau salinan berkas publik kepada pembimbing bila pengunduhan tidak tersedia.
3. Gunakan API publik yang terdokumentasi apabila pengelola mengonfirmasi ketersediaannya.
4. Pertimbangkan pengambilan otomatis terbatas setelah ketentuan akses dan pola pembaruan jelas.

Tidak perlu meminta kredensial database produksi. Materi hasil indeks mesin pencari dipakai untuk menemukan kandidat sumber, bukan dimasukkan sebagai bukti terverifikasi. Jika suatu sumber ditolak, catat sebagai belum tersedia dan lanjutkan dengan berkas publik yang dapat diperoleh.

## Bentuk hasil proyek

- Prototipe lokal dengan kolom percakapan dan kartu sumber.
- Koleksi sumber publik terkurasi beserta catatan waktu pengambilan dan versi.
- Modul pencarian, penjelasan metadata, dan penanganan sumber yang tidak tersedia.
- Kumpulan pertanyaan uji dan laporan hasil evaluasi.
- Dokumentasi instalasi, pembaruan koleksi, dan serah terima.

Widget pada situs resmi merupakan kemungkinan lanjutan setelah pengelola menilai prototipe, memberi izin integrasi, dan menentukan penanggung jawab operasional.

## Rencana kerja enam minggu

| Minggu | Pekerjaan | Hasil yang dapat ditinjau |
| --- | --- | --- |
| 1 | Sepakati satu tema, cek sumber publik, wawancara 3–5 calon pengguna | Batas proyek dan daftar sumber |
| 2 | Kurasi sumber, rapikan metadata, catat versi | Koleksi awal yang diverifikasi |
| 3 | Buat baseline pencarian kata kunci dan antarmuka percakapan | Pencarian dataset tanpa generasi bebas |
| 4 | Tambahkan pencarian semantik dan jawaban RAG bersumber | Demo metadata dengan sumber |
| 5 | Uji pertanyaan, perbaiki kegagalan, tambah tabel jika siap | Hasil evaluasi dan daftar batasan |
| 6 | Validasi pembimbing, dokumentasi dan presentasi | Paket serah terima prototipe |

Jadwal ini merupakan estimasi usulan, bergantung pada waktu magang dan ketersediaan bahan.

## Kriteria penerimaan yang diusulkan

Siapkan 50 pertanyaan yang ditinjau manusia: 15 pencarian dataset, 10 definisi, 10 pertanyaan periode/wilayah, 10 kasus bukti tidak tersedia, dan 5 instruksi manipulatif. Gunakan 20 untuk pengembangan dan 30 untuk evaluasi akhir yang disimpan terpisah. Jika fitur angka diaktifkan, tambahkan sedikitnya 10 kasus tabel yang sudah memiliki jawaban acuan.

- Recall@5 pencarian minimal 85% pada pertanyaan pencarian yang memiliki sumber acuan.
- Minimal 90% jawaban faktual dinilai sepenuhnya didukung sumber oleh peninjau.
- Seluruh jawaban faktual yang diberikan memiliki rujukan yang bisa ditelusuri ke koleksi.
- Seluruh kasus bukti tidak tersedia dalam set uji ditangani tanpa menciptakan angka.
- Seluruh kasus tabel dalam set uji, jika fitur diaktifkan, benar angka, tahun, wilayah, dan satuannya.
- Catat median dan p95 waktu respons serta biaya aktual; sasaran waktu awal p95 paling lama 15 detik pada perangkat uji, untuk dievaluasi ulang.

Angka di atas adalah sasaran penerimaan, bukan hasil pengujian. Hasil pada set kecil tidak membuktikan sistem bebas kesalahan pada semua pertanyaan.

## Sumber daya dan kebutuhan dukungan

Pengembangan awal menggunakan laptop peserta magang dan penyimpanan lokal. Biaya layanan model bergantung pada pilihan model dan pemakaian; belum ada layanan berbayar atau pengeluaran yang diaktifkan. Uji awal dapat berjalan sebagai pencarian tanpa LLM, kemudian memakai model lokal atau API sesuai keputusan pembimbing.

Dukungan yang diminta dari pengelola: konfirmasi sumber publik yang boleh dipakai, penjelasan indikator yang ambigu, satu peninjau isi, dan waktu untuk evaluasi demo. Akses internal hanya dibahas jika benar-benar diperlukan pada fase berbeda.

## Risiko dan mitigasi

| Risiko | Penanganan |
| --- | --- |
| Jawaban tidak didukung data | Jawab hanya jika bukti cukup; tampilkan sumber; uji penolakan |
| Tahun pembaruan dianggap tahun observasi | Simpan tanggal publikasi, pembaruan, pengambilan, dan periode data secara terpisah |
| Salah satuan atau wilayah | Cocokkan metadata sebelum mengambil atau membandingkan angka |
| Sumber berubah atau dihapus | Simpan versi, hash, dan status aktif; perbarui indeks dan tandai jawaban berbasis salinan lama |
| Angka dari PDF salah terbaca | Pemeriksaan manual tabel; tunda fitur angka bila belum andal |
| Prototipe disangka layanan resmi | Tampilkan label prototipe serta cakupan koleksinya |
| Instruksi berbahaya dalam dokumen | Perlakukan isi sumber sebagai data; batasi alat dan validasi rujukan |

## Naskah pengajuan yang dapat disesuaikan

**Perihal: Permohonan Peninjauan Usulan Prototipe Chatbot Data Publik Satu Data Depok**

Yth. Tim Pengelola Satu Data Depok,

Saya [nama], [peserta magang/afiliasi], mengajukan usulan pengembangan prototipe Asisten Data Depok untuk membantu masyarakat mencari dataset, memahami metadata, dan menemukan publikasi melalui percakapan berbahasa Indonesia.

Tahap awal direncanakan menggunakan sumber publik terkurasi dan berjalan pada lingkungan pengembangan terpisah. Setiap jawaban faktual akan dilengkapi rujukan. Jika bahan belum tersedia atau pertanyaan belum cukup jelas, sistem akan menjelaskan keterbatasannya atau meminta rincian tambahan.

Saya memohon kesediaan tim untuk meninjau ruang lingkup usulan, mengonfirmasi daftar sumber publik yang sesuai, dan menunjuk pihak yang dapat menilai ketepatan hasil prototipe. Untuk tahap awal, pengembangan tidak memerlukan akses database internal. Integrasi dengan portal resmi dapat dibahas setelah hasil prototipe dievaluasi oleh pengelola.

Luaran yang diusulkan meliputi prototipe, dokumentasi pengolahan sumber, hasil evaluasi, serta panduan pengembangan lanjutan. Rancangan teknis dan rencana kerja terlampir pada paket dokumen ini.

Demikian usulan ini disampaikan untuk dipertimbangkan. Terima kasih atas waktu dan perhatian Bapak/Ibu.

[Nama]  
[Afiliasi / program studi]  
[Kontak]  
[Tanggal pengajuan]

Naskah ini belum dikirim kepada pihak mana pun.
