import { createContext, useContext } from 'react'

export interface AuthUser { id: string; username: string; role: string; mustChangePassword?: boolean }

interface AuthContextValue {
  currentUser: AuthUser | null
  onLogout: () => void
}

export const AuthContext = createContext<AuthContextValue>({
  currentUser: null,
  onLogout: () => {},
})

export function useAuth() { return useContext(AuthContext) }
