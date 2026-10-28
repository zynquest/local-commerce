import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get } from '../lib/api.js';
import { LoadingScreen } from '../components/StatusScreens.jsx';

/**
 * Printed QR codes (/q/<code>) normally redirect on the server. This route only runs when an installed app answered
 * the scan from its offline shell (an older app version): it asks the server where the code points and goes there.
 */
export default function QrRedirect() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState('loading');

  useEffect(() => {
    get(`/qr/${encodeURIComponent(code)}`)
      .then(({ slug }) => (slug ? navigate(`/s/${slug}`, { replace: true }) : setState('free')))
      .catch((err) => setState(err.status === 0 ? 'offline' : 'unknown'));
  }, [code, navigate]);

  if (state === 'loading') return <LoadingScreen />;
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-emerald-50 to-stone-50 p-5">
      <div className="card w-full max-w-sm space-y-3 p-6 text-center">
        <p className="font-extrabold text-brand">Vocal For Local</p>
        <h1 className="text-xl font-bold">
          {state === 'free' ? "This QR code isn't linked to a shop yet" : state === 'offline' ? "You're offline" : "We couldn't find this QR code"}
        </h1>
        <Link to="/stores" className="btn-brand w-full">Shop local stores</Link>
      </div>
    </div>
  );
}
