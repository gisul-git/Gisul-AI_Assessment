export interface BackendUser {
  id: string;
  name?: string | null;
  email: string;
  role: string;
  organization?: string | null;
  token: string;
  refreshToken?: string;
}

export interface AuthResponsePayload {
  token: string;
  user: {
    id: string;
    name?: string | null;
    email: string;
    role: string;
    organization?: string | null;
  };
}
