const { BlobServiceClient } = require('@azure/storage-blob');

const CONTAINER_NAME = process.env.FILES_CONTAINER || 'files';

let blobServiceClient = null;
let containerClient = null;

function getBlobServiceClient() {
  if (!blobServiceClient) {
    blobServiceClient = BlobServiceClient.fromConnectionString(process.env.STORAGE_CONNECTION);
  }
  return blobServiceClient;
}

/**
 * Container dibuat tanpa `blobAccessType`, artinya akses privat. Isi blob hanya
 * keluar lewat Function (lihat download-file.js), bukan lewat URL publik.
 */
function getFilesContainerClient() {
  if (!containerClient) {
    containerClient = getBlobServiceClient().getContainerClient(CONTAINER_NAME);
  }
  return containerClient;
}

async function uploadBlob(blobName, buffer, contentType) {
  const blockBlobClient = getFilesContainerClient().getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
}

async function downloadBlob(blobName) {
  const blockBlobClient = getFilesContainerClient().getBlockBlobClient(blobName);
  return blockBlobClient.downloadToBuffer();
}

async function deleteBlob(blobName) {
  const blockBlobClient = getFilesContainerClient().getBlockBlobClient(blobName);
  await blockBlobClient.deleteIfExists();
}

module.exports = {
  uploadBlob,
  downloadBlob,
  deleteBlob,
};
