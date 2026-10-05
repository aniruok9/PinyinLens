// Rear camera stream and frame capture (spec §4, §8).

export async function openCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

// Turns the camera off: stops the stream's tracks (the browser's camera indicator goes out) and
// detaches it from the video if it is still the one showing.
export function closeCamera(video, stream) {
  for (const track of stream?.getTracks() ?? []) track.stop();
  if (video.srcObject === stream) video.srcObject = null;
}

// iOS ends camera tracks while the app is in the background; only then do we re-acquire.
export const trackEnded = (stream) => !stream || stream.getVideoTracks().every((track) => track.readyState === 'ended');

// Intrinsic pixel size of a <video>, <img> or <canvas>.
export function sourceSize(element) {
  if (element instanceof HTMLVideoElement) return { width: element.videoWidth, height: element.videoHeight };
  if (element instanceof HTMLImageElement) return { width: element.naturalWidth, height: element.naturalHeight };
  return { width: element.width, height: element.height };
}

// Copies `region` ({ x, y, width, height } in source pixels) into `canvas`, resized to the region,
// and returns its RGBA pixels: { data, width, height }.
export function captureRegion(source, region, canvas) {
  canvas.width = region.width;
  canvas.height = region.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
  const { data, width, height } = ctx.getImageData(0, 0, region.width, region.height);
  return { data, width, height };
}
