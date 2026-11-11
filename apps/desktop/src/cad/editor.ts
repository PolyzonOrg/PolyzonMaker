// The code editor's language for CAD programs: JavaScript, and completion of the language's own words.
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { completeFromList } from '@codemirror/autocomplete';

const WORDS = 'box cyl cone ball torus pipe soft lathe poly profile sweep loft hull bar rod text model use wing rotor wheel track gear spring group part param place paint drop sdf'.split(' ');
const CHAIN = 'at mid move x y z on to rot turn scale fit flip both row grid ring around add cut keep hole corners round bevel shell patch color w d h left right front back bottom top p'.split(' ');

export const cadLanguage = () => [
	javascript(),
	javascriptLanguage.data.of({
		autocomplete: completeFromList([...WORDS.map((label) => ({ label, type: 'function' })), ...CHAIN.map((label) => ({ label, type: 'method' }))])
	})
];
