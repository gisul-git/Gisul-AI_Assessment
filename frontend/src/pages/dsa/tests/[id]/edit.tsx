'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/router'

export default function EditTestPage() {
  const router = useRouter()
  const { id } = router.query

  useEffect(() => {
    // TEMPORARY: Redirect back to tests list
    // TODO: Implement full test edit functionality
    if (id) {
      router.replace('/dsa/tests')
    }
  }, [id, router])

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      flexDirection: 'column',
      gap: '1rem'
    }}>
      <p>Redirecting...</p>
      <p style={{ fontSize: '0.875rem', color: '#666' }}>
        Edit functionality coming soon
      </p>
    </div>
  )
}
