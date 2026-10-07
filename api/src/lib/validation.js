/**
 * Batas aplikasi. Ini konstanta milik aplikasi, bukan angka batas Azure:
 * SWA sendiri mengizinkan request sampai 30 MB, dan kita memilih 10 MB agar
 * ada ruang untuk overhead multipart.
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const DRIVE_QUOTA_BYTES = 100 * 1024 * 1024;

module.exports = { MAX_FILE_BYTES, DRIVE_QUOTA_BYTES };
