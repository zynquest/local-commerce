// Prints a new VAPID key pair for web push. Put both lines in the server env (/etc/vfl/env) and restart.
// Generate once: changing the keys means every owner has to turn notifications on again.
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
