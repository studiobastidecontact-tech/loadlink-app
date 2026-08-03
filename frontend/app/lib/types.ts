export interface Company {
  id: string;
  name: string;
  category: string;
  phone: string | null;
  website: string | null;
  email: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
}
