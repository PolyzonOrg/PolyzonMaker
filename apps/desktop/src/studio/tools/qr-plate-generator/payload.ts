/**
 * What the QR code says: a link, plain text, a Wi-Fi network, a phone
 * number, an e-mail or a contact card, written in the formats phone
 * cameras understand (WIFI: of the ZXing project, tel:, mailto: RFC 6068,
 * vCard 3.0 RFC 2426). Pure.
 */

export type PayloadKind = 'link' | 'text' | 'wifi' | 'phone' | 'email' | 'contact';
export type WifiSecurity = 'WPA' | 'WEP' | 'nopass';

export interface PayloadFields {
	kind: PayloadKind;
	link: string;
	text: string;
	wifiName: string;
	wifiPassword: string;
	wifiSecurity: WifiSecurity;
	wifiHidden: boolean;
	phone: string;
	email: string;
	emailSubject: string;
	emailBody: string;
	contactName: string;
	contactOrg: string;
	contactPhone: string;
	contactEmail: string;
	contactSite: string;
}

/** Backslash before the characters the WIFI: format reserves. */
function wifiEscape(value: string): string {
	return value.replace(/([\\;,:"])/g, '\\$1');
}

/** vCard text value: backslash, comma, semicolon and line breaks escaped. */
function vcardEscape(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/([,;])/g, '\\$1')
		.replace(/\r?\n/g, '\\n');
}

/** Digits and a leading plus: «+7 (900) 123-45-67» → «+79001234567». */
export function cleanPhone(value: string): string {
	const trimmed = value.trim();
	const digits = trimmed.replace(/\D/g, '');
	return digits ? (trimmed.startsWith('+') ? '+' : '') + digits : '';
}

/** A bare domain gets https:// so phones open it as a link, not as text. */
export function normaliseLink(value: string): string {
	const v = value.trim();
	if (!v) return '';
	if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
	if (/^[\p{L}\d-]+(\.[\p{L}\d-]+)+(\/\S*)?$/u.test(v)) return `https://${v}`;
	return v;
}

/** The text to encode; empty when nothing is filled in. */
export function qrPayload(f: PayloadFields): string {
	switch (f.kind) {
		case 'link':
			return normaliseLink(f.link);
		case 'text':
			return f.text.trim();
		case 'wifi': {
			const name = f.wifiName.trim();
			if (!name) return '';
			const security = f.wifiSecurity === 'nopass' ? 'nopass' : f.wifiSecurity;
			const password = f.wifiSecurity === 'nopass' ? '' : `P:${wifiEscape(f.wifiPassword)};`;
			return `WIFI:T:${security};S:${wifiEscape(name)};${password}${f.wifiHidden ? 'H:true;' : ''};`;
		}
		case 'phone': {
			const phone = cleanPhone(f.phone);
			return phone ? `tel:${phone}` : '';
		}
		case 'email': {
			const to = f.email.trim();
			if (!to) return '';
			const query = [
				f.emailSubject.trim() && `subject=${encodeURIComponent(f.emailSubject.trim())}`,
				f.emailBody.trim() && `body=${encodeURIComponent(f.emailBody.trim())}`
			].filter(Boolean);
			return `mailto:${to}${query.length ? `?${query.join('&')}` : ''}`;
		}
		case 'contact': {
			const name = f.contactName.trim();
			const phone = cleanPhone(f.contactPhone);
			if (!name && !phone && !f.contactEmail.trim()) return '';
			// «Иван Петров»: the last word is the family name.
			const words = name.split(/\s+/).filter(Boolean);
			const family = words.length > 1 ? words[words.length - 1] : '';
			const given = words.length > 1 ? words.slice(0, -1).join(' ') : (words[0] ?? '');
			const lines = [
				'BEGIN:VCARD',
				'VERSION:3.0',
				`N:${vcardEscape(family)};${vcardEscape(given)};;;`,
				`FN:${vcardEscape(name || phone)}`,
				f.contactOrg.trim() && `ORG:${vcardEscape(f.contactOrg.trim())}`,
				phone && `TEL;TYPE=CELL:${phone}`,
				f.contactEmail.trim() && `EMAIL:${vcardEscape(f.contactEmail.trim())}`,
				f.contactSite.trim() && `URL:${vcardEscape(normaliseLink(f.contactSite))}`,
				'END:VCARD'
			].filter(Boolean);
			return lines.join('\r\n');
		}
		default:
			return '';
	}
}
