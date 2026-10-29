# Hasil verifikasi prototipe 0.1

Tanggal: 26 Oktober 2026. Lingkungan: Windows, Node.js 24.19.0, Microsoft Edge headless melalui Playwright. Tidak ada pengujian pada sistem internal atau situs produksi Pemerintah Kota Depok.

## Alur yang diperiksa

Pengguna membuka aplikasi → bertanya melalui browser → API mencari koleksi SQLite → sumber dipilih sesuai status → jawaban dan rujukan tampil. Untuk angka: pengguna mengimpor CSV → mencocokkan sumber → melakukan verifikasi lokal → meminta satu observasi → memeriksa baris sumber.

## Hasil

| Pemeriksaan | Hasil aktual |
| --- | --- |
| `npm.cmd run check` | Lulus pemeriksaan sintaks/modul JavaScript |
| `npm.cmd test` | 11 pengujian lulus, 0 gagal |
| `npm.cmd run test:e2e` | Seluruh skenario browser lulus |
| Halaman desktop | Diperiksa visual melalui screenshot 1440 × 1000 |
| Halaman mobile | Diperiksa visual dan interaksi pada viewport 390 × 844; tidak ada overflow horizontal pada halaman yang diuji |
| Error browser | Tidak ada pageerror atau console error pada sesi uji |
| Endpoint kesehatan | HTTP berhasil; respons `ok: true`, versi `0.1.0` |
| Persistensi | Sumber dan observasi tetap tersedia setelah database ditutup dan dibuka kembali |

Pengujian browser memeriksa:

1. Percakapan latihan menghasilkan kutipan sumber dan kartu rujukan.
2. Riwayat percakapan bertahan setelah reload browser.
3. Koleksi publik tidak memakai panduan latihan atau kandidat sebagai bukti faktual.
4. Berkas CSV dipilih melalui UI, disimpan, diperiksa, dan diverifikasi lokal.
5. Pertanyaan angka menampilkan nilai fixture dan rujukan baris CSV yang benar.
6. Sumber yang dinonaktifkan dikeluarkan dari jawaban baru.
7. Percakapan, navigasi, koleksi, dan pengaturan berfungsi pada ukuran mobile.
8. Kontrol model nonaktif ketika model lokal tidak tersedia.

Uji backend juga mencakup nilai nol/desimal, CSV rusak atau ambigu, observasi duplikat, validasi URL, pemisahan status, tahun/wilayah/indikator yang berbeda, konflik sumber, klarifikasi lanjutan singkat, permintaan data pribadi, instruksi mengarang angka, pembatasan origin/ukuran permintaan, serta ekspor.

## Integrasi model

Adapter AI SDK/Ollama diuji dengan server tiruan yang menyediakan endpoint daftar model, embedding, dan chat completion. Uji memastikan pencarian hybrid berjalan, ID kutipan yang valid diterima, ID palsu ditolak, serta fallback kata kunci bekerja saat embedding/model gagal.

**Inferensi dengan model Ollama sungguhan belum diuji pada bagian ini.** Aplikasi dapat digunakan tanpa model; model lokal belum dikonfigurasi pada perangkat ini saat versi 0.2 diperiksa. Pembaruan 29 Oktober 2026 di bawah mencatat uji Ollama sungguhan yang sudah lulus.

## Batas kesimpulan

- Angka yang digunakan saat pengujian adalah fixture fiktif berlabel uji pada database sementara; bukan statistik Depok dan tidak dimasukkan ke koleksi pengguna.
- Korpus awal aplikasi berisi 3 panduan latihan, 3 kandidat tautan portal, dan 0 sumber publik terverifikasi.
- Pengujian fungsi tidak membuktikan akurasi untuk seluruh pertanyaan bahasa Indonesia. Evaluasi relevansi dan ketepatan jawaban dengan sumber asli masih diperlukan.
- Target Recall@5 dan dukungan sumber pada proposal belum diukur karena koleksi acuan publik belum tersedia.
- Pratinjau otomatis bawaan gagal memulai runtime browser pada lingkungan ini; pemeriksaan browser dilakukan menggunakan Edge lokal melalui Playwright.
- Sistem belum dinilai untuk hosting publik, pemakaian banyak pengguna, aksesibilitas menyeluruh, atau ketahanan beban.

Screenshot hasil uji tersedia dalam `.artifacts/` (tidak dimasukkan ke Git): `asisten-data-desktop.png`, `asisten-data-mobile.png`, dan `asisten-data-jawaban.png`.

## Pembaruan: simulasi portal dan popup

Pada 26 Oktober 2026, simulasi portal ditambahkan di `/`; ruang percakapan dipindahkan ke `/chat`. Identitas visual mengikuti referensi publik yang berhasil dibaca melalui HTTP/browser biasa: navy, merah marun, latar biru muda, serta logo dan ilustrasi publik. Pernyataan penolakan akses pada pengamatan awal adalah hasil alat penelusuran saat itu, bukan kondisi semua metode akses berikutnya.

Uji backend tetap lulus 11/11 setelah perubahan. Kedua suite browser (`browser-check.mjs` dan `portal-browser-check.mjs`) lulus. Tambahan skenario yang diperiksa:

- Halaman simulasi, logo/ilustrasi lokal, pencarian dan filter katalog, serta tampilan hasil kosong.
- Tombol mengambang membuka popup; tombol tutup dan Escape menutupnya serta mengembalikan fokus.
- Pertanyaan cepat mendapat jawaban dari API yang sama dan rujukan sumber.
- Riwayat popup terbawa ke chatbot penuh dan tetap ada ketika kembali ke portal.
- Tautan pertanyaan otomatis dan kartu sumber membuka pertanyaan/detail yang benar.
- Warna tombol utama chatbot sesuai navy portal `rgb(36, 48, 98)`.
- Menu mobile, popup dalam batas viewport 390 × 844, navigasi ke chatbot penuh, dan ketiadaan overflow horizontal.
- Tidak ditemukan pageerror atau console error pada skenario uji.

Screenshot tambahan: `portal-depok-desktop.png`, `portal-depok-popup.png`, `portal-depok-mobile.png`, dan `portal-depok-popup-mobile.png`. Snapshot jumlah portal pada halaman simulasi tidak masuk ke korpus jawaban chatbot sebagai nilai statistik dataset.

## Pembaruan: halaman percakapan penuh untuk pengunjung

Halaman `/chat` kini menggunakan antarmuka khusus pengunjung. Antarmuka pengelolaan sebelumnya dipindahkan ke `/workspace`. Ini pemisahan navigasi dan tampilan, bukan penerapan autentikasi baru. Sistem RAG/backend jawaban tidak dikembangkan ulang dalam pembaruan ini.

Hasil verifikasi:

- Pemeriksaan JavaScript lulus; 11 pengujian backend lulus.
- Suite pengelolaan tetap lulus setelah alamatnya dipindahkan ke `/workspace`.
- Suite portal dan percakapan lulus, termasuk perpindahan popup → layar penuh dan riwayat dua arah.
- Percakapan baru, pengarsipan/pemilihan percakapan, pencarian riwayat, unduhan, serta pemulihan setelah reload berfungsi dalam skenario uji.
- Halaman pengunjung tidak menampilkan formulir impor atau pengaturan model.
- Pada viewport mobile 390 × 844, panel riwayat dan sumber dapat dibuka, ditutup dengan Escape, dan digunakan untuk membuka detail rujukan tanpa overflow horizontal.
- Tautan sumber/pertanyaan dikonsumsi sekali sehingga reload tidak membuka kembali detail sumber dari navigasi sebelumnya.
- Tidak ditemukan pageerror atau console error pada skenario browser yang diuji.

Screenshot: `full-chat-depok-desktop.png`, `full-chat-depok-answer.png`, dan `full-chat-depok-mobile.png` dalam `.artifacts/`.

## Pembaruan: RAG versi 0.2 dan korpus publik

Pengambilan terkurasi berhasil memperoleh metadata publik dan CSV yang ditautkan melalui pratinjau portal. Empat salinan yang telah dicocokkan dengan sumbernya diaktifkan, termasuk lima observasi penanganan sampah. Dua metadata tambahan tetap menunggu peninjauan. Pemeriksaan salinan ini bukan pengesahan pemerintah.

Hasil aktual:

- `npm.cmd run check`: lulus.
- `npm.cmd test`: 22 pengujian lulus, termasuk SDK OpenAI Responses/embeddings melalui server tiruan, klaim/ID/kutipan palsu, angka baru, galat autentikasi/kuota, perubahan status sumber selama generasi, pembacaan ulang `.env`, dan konteks lanjutan tahun.
- `npm.cmd run test:corpus`: 18/18 kasus pada sumber publik pilot lulus, tanpa LLM. Termasuk definisi, satuan, rumus, lima angka tahunan, periode terbaru, penolakan cakupan yang tidak ada, dan catatan indikator historis.
- Kedua suite browser portal/workspace lulus setelah integrasi.
- Pemeriksaan browser dengan database workspace asli berhasil membaca angka 2025 sebesar 53,09 persen, dengan rujukan CSV baris 6. Definisi dan rumus tersedia sebagai kutipan sumber.
- Tidak ada pageerror pada pemeriksaan browser korpus asli.

**Uji OpenAI sungguhan belum lulus:** perintah `rag:activate` mendeteksi `missing_key` ketika OPENAI_API_KEY masih kosong. Tidak ada klaim bahwa permintaan provider asli sudah berhasil, dan tidak ada tagihan API yang disimpulkan dari pengujian tiruan. Setelah kunci tersedia, jalankan ulang perintah tersebut atau tombol uji di workspace.

Pembaruan 26 Oktober 2026: konfigurasi API key sudah terbaca. Uji aktivasi berhenti pada tahap embedding dengan HTTP 429; diagnosis permintaan embedding langsung mengembalikan `error.code=credit_balance_exhausted` dan `error.type=insufficient_quota`. Saldo kredit API organisasi perlu tersedia sebelum uji dilanjutkan. Belum ada jawaban LLM sungguhan yang berhasil dihasilkan. Pesan aplikasi kini membedakan saldo habis, batas akun, dan pembatasan kecepatan permintaan; respons mentah provider dan kunci tetap tidak ditampilkan. Rujukan: https://developers.openai.com/api/docs/guides/error-codes

Laporan lokal: `.artifacts/public-corpus-eval.json`, `.artifacts/rag-browser-latest.json`, dan `.artifacts/rag-live-latest.json`. Laporan corpus/browser tidak menggantikan uji LLM asli, benchmark recall umum, atau evaluasi semantik manusia.

## Pembaruan: aktivasi Ollama tanpa kredit API

Tanggal: 29 Oktober 2026. Blocker kredit OpenAI diganti dengan Ollama lokal agar demo ke Diskominfo tidak bergantung pada saldo API. Lingkungan: Windows, Node.js 24.19.0, Ollama 0.40.12, CPU/GPU terintegrasi, RAM 16 GB.

Model yang dipasang:

- `qwen2.5:3b-instruct` (1,9 GB) untuk pemilihan bukti.
- `bge-m3` (1,2 GB) untuk embedding multibahasa.

Hasil aktual:

| Pemeriksaan | Hasil |
| --- | --- |
| `npm.cmd run rag:activate` | `ok: true`, `llmResponseObserved: true`, 4/4 kasus lulus |
| Indeks embedding | 5/5 potongan publik, model `ollama:bge-m3` |
| “Apa itu metadata?” | `mode: model-assisted`, `method: hybrid`, kutipan “Metadata adalah data yang memberikan informasi tentang data lain.” |
| “Apa rumus persentase penanganan sampah?” | `mode: model-assisted`, `method: hybrid`, kutipan rumus dari metadata sampah |
| Angka 2025 | `method: structured`, 53,09 persen, CSV baris 6 |
| Pertanyaan tahun 2099 | `insufficient_evidence`, tidak menebak |
| `npm.cmd test` | 23/23 lulus |
| `npm.cmd run test:corpus` | 18/18 lulus |
| `npm.cmd run check` | lulus |

Catatan teknis:

- Pada uji ini Ollama hanya memilih ID kutipan (`model-assisted`). Pembaruan 29 Oktober 2026 menambahkan penyusunan kalimat oleh model lokal; lihat bagian berikutnya.
- ID bukti panjang dipetakan menjadi nomor pendek sebelum dikirim ke model. Model 3B sebelumnya menghasilkan JSON tidak valid saat diminta menyalin UUID panjang; setelah pemetaan, output stabil dan lebih cepat (sekitar 1–14 detik per pertanyaan pada perangkat ini).
- Panggilan Ollama kini tercatat pada `rag_runs` sehingga workspace menampilkan status panggilan terakhir.
- Kunci OpenAI dihapus dari `.env` workspace. Jika kunci itu pernah dibagikan, revoke melalui dashboard OpenAI.

Batas: kualitas pemilihan kutipan bergantung pada model 3B dan korpus pilot. Uji ini membuktikan jalur inferensi, embedding, dan hybrid aktif, bukan akurasi menyeluruh untuk semua pertanyaan bahasa Indonesia.

## Pembaruan: model lokal menyusun jawaban (29 Oktober 2026)

Kekurangan sebelumnya: pada pertanyaan teks, Ollama hanya memilih kutipan sehingga pengguna menerima kalimat template "Berikut kutipan yang cocok…". Pembaruan ini menambahkan penyusunan kalimat tanpa membuang pengaman.

Alur baru untuk provider lokal:

1. Pencarian hybrid mengambil potongan sumber terverifikasi.
2. `selectEvidence` memilih 1–3 kalimat bukti. Kontrak outputnya kecil sehingga cepat dan stabil pada model 3B.
3. `composeLocalAnswer` menyusun satu kalimat jawaban hanya dari kalimat bukti itu.
4. Validasi menolak jawaban yang memuat URL, angka yang tidak ada di kutipan, atau kalimat terlalu pendek (di bawah 20 karakter atau 4 kata).
5. Jika langkah 3–4 gagal, jawaban turun ke `model-assisted` (kutipan sumber) dengan pemberitahuan. Kalimat yang tidak lolos pemeriksaan tidak pernah ditampilkan.

Hasil aktual:

| Pemeriksaan | Hasil |
| --- | --- |
| `npm.cmd run rag:activate` | `ok: true`, `llmResponseObserved: true`, 4/4 kasus |
| Mode dua kasus generatif | `generated` + `hybrid` |
| Contoh jawaban metadata | "Metadata adalah data yang memberikan informasi tentang data lain, …" [1] |
| Contoh jawaban satuan | "Satuan penanganan sampah adalah persen." [1] |
| Latensi pertanyaan teks | 3,8–8,9 detik; sekitar 2 detik saat model hangat |
| `npm.cmd test` | 26/26 lulus |
| `npm.cmd run check` | lulus |

Catatan teknis:

- Pendekatan "model mengembalikan klaim dan kutipan bertingkat" diuji lalu ditinggalkan: `qwen2.5:3b-instruct` sering menghilangkan field `quotes` (ZodError) dan memakan 17–34 detik.
- Kontrak dua tahap (pilih bukti, lalu susun kalimat) lebih andal dan cepat karena keluaran model hanya sekitar 20–40 token.
- Kode baru: `composeLocalAnswer()` pada `server/grounding.js`; jalur pemilihan bukti lama tetap menjadi cadangan.
- `scripts/activate-rag.mjs` kini ketat: hanya `mode: generated` yang dihitung lulus, sehingga fallback tidak bisa menyamarkan kegagalan model.
- Batas: pemeriksaan bersifat mekanis (angka, URL, panjang, ID bukti). Makna kalimat tetap bergantung pada model 3B dan korpus pilot.

## Pembaruan: kesiapan demo dan GitHub (29 Oktober 2026)

Provider chatbot dikembalikan ke **Ollama**. Model asisten coding bukan konfigurasi chatbot proyek dan tidak dipilih lewat `.env` aplikasi.

Perbaikan menjelang demo:

- Komposisi lokal kini memanggil `validateGroundedOutput()` juga: kutipan dipasang backend, lalu ID, isi kutipan, angka, dan teks terlarang diperiksa dengan fungsi yang sama seperti jalur hosted.
- Jika salah satu sumber dinonaktifkan selama komposisi, seluruh kalimat model dibatalkan; kutipan sumber aktif lain tidak boleh dipakai untuk melegitimasi jawaban dari sumber yang sudah ditarik.
- UUID tidak dikirim ke tahap penyusunan kalimat; referensi dipasang backend. Ini memperkecil payload tanpa mengubah sumber bukti.
- Tes browser memakai Chromium Playwright dan profil sementara. Tidak memerlukan akun/profil browser pribadi.
- Tambahan `test:e2e:live` menguji halaman `/chat` melalui Ollama sungguhan, bukan respons tiruan.
- README memuat penyiapan clone pertama. GitHub Actions menguji kode, unit, dan e2e dengan database sementara; model Ollama dan koleksi lokal tidak disertakan di repo.

Hasil verifikasi final lokal:

| Pemeriksaan | Hasil |
| --- | --- |
| `npm.cmd run check` | lulus |
| `npm.cmd test` | 28/28 lulus |
| `npm.cmd run test:corpus` | 18/18 lulus |
| `npm.cmd run test:e2e` | 13 pemeriksaan lulus, desktop + mobile |
| `npm.cmd run rag:activate` | 4/4 lulus dengan provider Ollama |
| `npm.cmd run test:e2e:live` | 6/6 pertanyaan lulus; sumber, riwayat setelah reload, dan mobile lulus |
| `npm.cmd audit --omit=dev --audit-level=high` | 0 kerentanan dilaporkan |

Uji live terakhir mencatat metadata **14.563 ms**, rumus **6.165 ms**, satuan **3.756 ms**, angka 2025 **7 ms**, tindak lanjut 2024 **3 ms**, dan penolakan tahun 2099 **2 ms**. Tiga pertanyaan teks semuanya `generated` + `hybrid` dengan provider `ollama`; angka memakai jalur `structured`.

Uji sebelumnya mencatat 19–34 detik untuk teks. Kondisi beban mesin, pemuatan model, dan ukuran prompt memengaruhi latensi; angka ini bukan benchmark p95 atau jaminan performa. Model berjalan pada CPU di laptop ini.

Screenshot dan laporan pengujian ada di `.artifacts/` laptop. `.env`, database, salinan mentah, sesi browser, dan keluaran graphify lokal diabaikan Git. Panduan pelaksanaan: [08-checklist-presentasi.md](08-checklist-presentasi.md).
