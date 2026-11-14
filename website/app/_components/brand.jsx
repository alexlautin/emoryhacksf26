import pug from '../../src/assets/pug.png';

export function Pug({ size = 44, className = '' }) {
  return <img className={`pug ${className}`} src={pug.src} width={size} height={Math.round(size * pug.height / pug.width)} alt="" />;
}

export default function Brand() {
  return <a className="brand" href="/" aria-label="Harness, home"><Pug size={40} /><span>Harness</span></a>;
}
