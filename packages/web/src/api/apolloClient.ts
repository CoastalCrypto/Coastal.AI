import { ApolloClient, InMemoryCache, HttpLink, ApolloLink } from '@apollo/client'
import { coreHttpOrigin } from '../platform/coreOrigin'

/**
 * Apollo Client for GraphQL queries
 * Connects to the backend /graphql endpoint with authentication headers
 */

// Auth link to add session token to outgoing requests
const authLink = new ApolloLink((operation, forward) => {
  const token = sessionStorage.getItem('cc_admin_session') ?? ''
  operation.setContext({
    headers: {
      'x-admin-session': token,
    },
  })
  return forward(operation)
})

// Core origin resolves the Tauri-injected dynamic port when present. See
// platform/coreOrigin.ts.
const httpLink = new HttpLink({
  uri: `${coreHttpOrigin()}/graphql`,
  credentials: 'same-origin',
})

export const apolloClient = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-and-network',
    },
    query: {
      fetchPolicy: 'cache-first',
    },
  },
})
