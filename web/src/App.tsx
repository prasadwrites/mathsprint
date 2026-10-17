import { onAuthStateChanged, type User } from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useActivityHeartbeat } from "./lib/activity";
import { getAccount } from "./lib/db";
import { auth } from "./lib/firebase";
import type { AccountSummary } from "./lib/types";
import Accounts from "./pages/Accounts";
import CreateDeck from "./pages/CreateDeck";
import Dashboard from "./pages/Dashboard";
import DeckReview from "./pages/DeckReview";
import Login from "./pages/Login";
import Practice from "./pages/Practice";
import PracticeSetup from "./pages/PracticeSetup";
import Results from "./pages/Results";
import Upgrade from "./pages/Upgrade";

const UserContext = createContext<User | null>(null);
export const useUser = () => useContext(UserContext)!;

/** null while loading, or if the account couldn't be read (the server still enforces every limit). */
const AccountContext = createContext<{ account: AccountSummary | null; refresh: () => void }>({ account: null, refresh: () => {} });
export const useAccount = () => useContext(AccountContext);

const ADMIN_EMAIL = "prasad.writes@gmail.com";
/** Decides only what the admin sees. Every admin action is checked again by the functions. */
export function useIsAdmin() {
  const user = useUser();
  const { account } = useAccount();
  return !!account?.isAdmin || (user.emailVerified && user.email?.toLowerCase() === ADMIN_EMAIL);
}

function AdminOnly() {
  return useIsAdmin() ? <Accounts /> : <Navigate to="/" replace />;
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useActivityHeartbeat(!!user);

  const refresh = useCallback(() => {
    getAccount()
      .then(setAccount)
      .catch(() => setAccount(null));
  }, []);
  useEffect(() => {
    setAccount(null);
    if (user) refresh();
  }, [user, refresh]);

  if (user === undefined) {
    return (
      <div className="wrap">
        <span className="spinner" />
      </div>
    );
  }
  if (!user) return <Login />;

  return (
    <UserContext.Provider value={user}>
      <AccountContext.Provider value={{ account, refresh }}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/create" element={<CreateDeck />} />
        <Route path="/decks/:deckId" element={<DeckReview />} />
        <Route path="/decks/:deckId/practice" element={<PracticeSetup />} />
        <Route path="/sessions/:sessionId" element={<Practice />} />
        <Route path="/sessions/:sessionId/results" element={<Results />} />
        <Route path="/admin" element={<AdminOnly />} />
        <Route path="/upgrade" element={<Upgrade />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </AccountContext.Provider>
    </UserContext.Provider>
  );
}
