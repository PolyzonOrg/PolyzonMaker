// Minimal fontconfig bootstrap for the browser OpenSCAD runtime. The previous
// generated module embedded several Liberation font binaries as hexadecimal
// JavaScript (~7.8 MiB). Polyzon uses one separately cached Noto Sans file, so
// only the font directory configuration is required here.
const CONFIG = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig><dir>/fonts</dir></fontconfig>`;

function exists(fs, path) {
	try {
		fs.stat(path);
		return true;
	} catch {
		return false;
	}
}

function addFonts(openscad) {
	if (!exists(openscad.FS, '/fonts')) openscad.FS.mkdir('/fonts');
	openscad.FS.writeFile('/fonts/fonts.conf', new TextEncoder().encode(CONFIG));
}

export { addFonts };
