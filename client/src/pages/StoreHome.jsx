import BookingStorefront from './BookingStorefront.jsx';
import Storefront from './Storefront.jsx';
import { useStore } from '../context/StoreContext.jsx';

/** A store's home page: product catalog for shops, services + booking for appointment businesses. */
export default function StoreHome() {
  const { store } = useStore();
  return store?.business_type === 'appointments' ? <BookingStorefront /> : <Storefront />;
}
