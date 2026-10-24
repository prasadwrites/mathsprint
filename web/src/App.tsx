import { onAuthStateChanged, type User } from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useActivityHeartbeat } from "./lib/activity";
import { claimChallenge, claimPublicTest, getAccount, savePostDeck } from "./lib/db";
import { clearClaim, pendingClaim } from "./lib/challenge";
import { clearPublicClaim, pendingPublicClaim } from "./lib/publicTest";
import { clearPostSave, pendingPostSave } from "./lib/questionPost";
import { clearInvite, pendingInvite } from "./lib/invite";
import { clearRef, pendingRef } from "./lib/signupRef";
import { auth } from "./lib/firebase";
import type { AccountSummary } from "./lib/types";
import Accounts from "./pages/Accounts";
import CreateDeck from "./pages/CreateDeck";
import Dashboard from "./pages/Dashboard";
import DeckReview from "./pages/DeckReview";
import Engagement from "./pages/Engagement";
import Groups from "./pages/Groups";
import Login from "./pages/Login";
import Practice from "./pages/Practice";
import PracticeSetup from "./pages/PracticeSetup";
import Plans from "./pages/Plans";
import Report from "./pages/Report";
import PlayChallenge from "./pages/PlayChallenge";
import PlayPublicTest from "./pages/PlayPublicTest";
import PlayQuestionPost from "./pages/PlayQuestionPost";
import Results from "./pages/Results";
import TakeTest from "./pages/TakeTest";
import TestResults from "./pages/TestResults";
import MemberResult from "./pages/MemberResult";
import Invite from "./pages/Invite";
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

function AdminOnly({ children }: { children: React.ReactNode }) {
  return useIsAdmin() ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  // Pages anyone can open without signing in: a group member's test, a friend's challenge, a public test link, a
  // question post, and the plan comparison.
  const { pathname } = useLocation();
  if (["/t/", "/c/", "/play/", "/p/", "/quiz/", "/q/", "/question/"].some((p) => pathname.startsWith(p)) || pathname === "/plans") {
    return (
      <Routes>
        <Route path="/t/:token" element={<TakeTest />} />
        <Route path="/c/:token" element={<PlayChallenge />} />
        {/* Where /c/ sends visitors if its link-preview function can't reach the site. */}
        <Route path="/play/:token" element={<PlayChallenge />} />
        <Route path="/p/:token" element={<PlayPublicTest />} />
        {/* Where /p/ sends visitors if its link-preview function can't reach the site. */}
        <Route path="/quiz/:token" element={<PlayPublicTest />} />
        <Route path="/q/:token" element={<PlayQuestionPost />} />
        {/* Where /q/ sends visitors if its link-preview function can't reach the site. */}
        <Route path="/question/:token" element={<PlayQuestionPost />} />
        <Route path="/plans" element={<Plans />} />
      </Routes>
    );
  }
  return <SignedInApp />;
}

function SignedInApp() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  // A ref, since navigate changes on every route change and refresh must not.
  const navigate = useRef(useNavigate());
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useActivityHeartbeat(!!user);

  const refresh = useCallback(() => {
    getAccount(pendingInvite()?.token, pendingRef() ?? undefined)
      .then(async (a) => {
        clearInvite(); // the server has seen it; it only counts for a brand new account anyway
        clearRef(); // same: only a brand new account is tagged
        // A challenge played before signing in: save it to this account before the home page lists challenges.
        const claim = pendingClaim();
        if (claim) await claimChallenge(claim.token, claim.attempt).catch(() => {});
        clearClaim();
        // A public test played before signing in: put it on the leaderboard, then show the player their place.
        const pub = pendingPublicClaim();
        clearPublicClaim();
        const placed = pub && (await claimPublicTest(pub.token, pub.attempt).catch(() => null));
        // A question post's deck the visitor asked to keep when they signed up: save it, then open it.
        const post = pendingPostSave();
        clearPostSave();
        const kept = post && (await savePostDeck(post.token).catch(() => null));
        setAccount(a);
        if (pub && placed?.saved) navigate.current(`/p/${pub.token}`);
        else if (kept) navigate.current(`/decks/${kept.deckId}`);
      })
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
        <Route path="/admin" element={<AdminOnly><Accounts /></AdminOnly>} />
        <Route path="/admin/engagement" element={<AdminOnly><Engagement /></AdminOnly>} />
        <Route path="/upgrade" element={<Upgrade />} />
        <Route path="/invite" element={<Invite />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/report" element={<Report />} />
        <Route path="/tests/:testId" element={<TestResults />} />
        <Route path="/tests/:testId/m/:token" element={<MemberResult />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </AccountContext.Provider>
    </UserContext.Provider>
  );
}
