import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export const dsaApi = axios.create({
  baseURL: `${API_URL}/api/dsa`,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add token to requests - CRITICAL: All DSA API calls require authentication
dsaApi.interceptors.request.use(async (config) => {
  if (typeof window !== 'undefined') {
    // Try to get token from NextAuth session first, fallback to localStorage
    let token: string | null = null
    try {
      // Check if NextAuth is available
      const { getSession } = await import('next-auth/react')
      const session = await getSession()
      if (session?.backendToken) {
        token = session.backendToken
      }
    } catch (e) {
      // NextAuth not available, use localStorage
      console.warn('[dsaApi] NextAuth not available, using localStorage fallback')
    }
    
    // Fallback to localStorage if session token not available
    if (!token) {
      token = localStorage.getItem('token')
    }
    
    // CRITICAL: Log warning if no token found (but don't block - let backend handle 401)
    if (!token) {
      console.error('[dsaApi] SECURITY WARNING: No authentication token found for DSA API request:', config.url)
      console.error('[dsaApi] This request will likely fail with 401 Unauthorized')
    } else {
      config.headers.Authorization = `Bearer ${token}`
      // Log token presence (but not the token itself) for debugging
      console.debug('[dsaApi] Authorization token added to request:', config.url)
    }
  }
  return config
})

// Handle 401 errors (unauthorized)
dsaApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear auth data and redirect to login
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        window.location.href = '/auth/signin'
      }
    }
    return Promise.reject(error)
  }
)

export default dsaApi

