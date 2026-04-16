import * as FileSystem from 'expo-file-system/legacy';
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
  const localUri = (FileSystem.cacheDirectory ?? '') + fileName;

  let downloadResult: FileSystem.FileSystemDownloadResult;
  try {
    downloadResult = await FileSystem.downloadAsync(url, localUri, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e: any) {
    return { ok: false, error: e.message || 'Netwerkfout' };
  }

  if (downloadResult.status === 413) {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
    return { ok: false, error: 'Bestand te groot (>50MB)' };
  }
  if (downloadResult.status === 404) {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
    return { ok: false, error: 'Bestand niet gevonden' };
  }
  if (downloadResult.status !== 200) {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
    return { ok: false, error: `Serverfout (${downloadResult.status})` };
  }

  const ext = getExtension(fileName);
  const isMedia = MEDIA_EXTENSIONS.has(ext);

  if (isMedia) {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status === 'granted') {
      try {
        await MediaLibrary.saveToLibraryAsync(localUri);
        await FileSystem.deleteAsync(localUri, { idempotent: true });
        return { ok: true, target: 'camera' };
      } catch (e: any) {
        // fallthrough to share sheet
      }
    }
  }

  // Share sheet (also fallback when MediaLibrary permission denied)
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    await FileSystem.deleteAsync(localUri, { idempotent: true });
    return { ok: false, error: 'Delen niet beschikbaar op dit apparaat' };
  }
  await Sharing.shareAsync(localUri, { UTI: 'public.item' });
  await FileSystem.deleteAsync(localUri, { idempotent: true });
  return { ok: true, target: 'share' };
}
