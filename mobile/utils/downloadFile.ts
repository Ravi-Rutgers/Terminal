import { Paths, File as FSFile } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv',
  '.jpg', '.jpeg', '.png', '.gif', '.heic', '.webp',
  '.mp3', '.wav', '.aac',
]);

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

export async function downloadFile(
  serverUrl: string,
  token: string,
  filePath: string,
  fileName: string,
): Promise<{ ok: true; target: 'camera' | 'share' } | { ok: false; error: string }> {
  const url = `${serverUrl}/api/files/download?path=${encodeURIComponent(filePath)}`;
  const cacheDir = Paths.cache;

  let downloadedFile: any;
  try {
    // FSFile.downloadFileAsync is a static method that downloads and returns the File object
    downloadedFile = await FSFile.downloadFileAsync(url, cacheDir, {
      headers: { Authorization: `Bearer ${token}` },
      idempotent: true,
    });
  } catch (e: any) {
    const errMsg = e.message || 'Netwerkfout';
    if (errMsg.includes('413')) {
      return { ok: false, error: 'Bestand te groot (>50MB)' };
    }
    if (errMsg.includes('404')) {
      return { ok: false, error: 'Bestand niet gevonden' };
    }
    return { ok: false, error: errMsg };
  }

  const ext = getExtension(fileName);
  const isMedia = MEDIA_EXTENSIONS.has(ext);

  if (isMedia) {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status === 'granted') {
      try {
        await MediaLibrary.saveToLibraryAsync(downloadedFile.uri);
        await downloadedFile.delete();
        return { ok: true, target: 'camera' };
      } catch (e: any) {
        // fallthrough to share sheet
      }
    }
  }

  // Share sheet (also fallback when MediaLibrary permission denied)
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    await downloadedFile.delete();
    return { ok: false, error: 'Delen niet beschikbaar op dit apparaat' };
  }
  await Sharing.shareAsync(downloadedFile.uri, { UTI: 'public.item' });
  await downloadedFile.delete();
  return { ok: true, target: 'share' };
}
