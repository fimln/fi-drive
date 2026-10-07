// Entrypoint Functions. Setiap modul di ./functions wajib di-require di sini
// agar registrasi app.http() ikut tereksekusi saat worker dimuat.
require('./functions/me');
require('./functions/list-files');
require('./functions/upload-file');
require('./functions/download-file');
require('./functions/delete-file');
require('./functions/public-links');
