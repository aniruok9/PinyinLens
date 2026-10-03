// URL parameters (spec §4, §8):
//   ?img=<url>   use a still image instead of the camera (desktop testing, E2E tests)
//   ?det=<id>    detector model id from ocr/manifest.json (on-device comparison)
//   ?rec=<id>    recognizer model id from ocr/manifest.json
//   ?debug       show the debug panel
export function readParams(search) {
  const query = new URLSearchParams(search);
  return { img: query.get('img'), det: query.get('det'), rec: query.get('rec'), debug: query.has('debug') };
}

// The detector/recognizer to load: the requested ids when the manifest ships them, otherwise
// the manifest default. `rejected` lists requested ids that were ignored.
export function chooseModels(params, manifest) {
  const rejected = [];
  const pick = (kind) => {
    const wanted = params[kind];
    if (wanted && manifest[kind][wanted]) return wanted;
    if (wanted) rejected.push(`${kind}=${wanted}`);
    return manifest.default[kind];
  };
  return { det: pick('det'), rec: pick('rec'), rejected };
}
