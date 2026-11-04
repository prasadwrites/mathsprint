import { onAuthStateChanged, type User } from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useActivityHeartbeat } from "./lib/activity";
import { claimChallenge, claimPublicTest, getAccount, redeemOfferCode, savePostDeck } from "./lib/db";
import { clearClaim, pendingClaim } from "./lib/challenge";
import { clearPublicClaim, pendingPublicClaim } from "./lib/publicTest";
import { clearPostSave, pendingPostSave } from "./lib/questionPost";
import { clearInvite, pendingInvite } from "./lib/invite";
import { clearRef, pendingRef } from "./lib/signupRef";
import { clearTerms, pendingTerms } from "./lib/terms";
import { clearOfferCode, pendingOfferCode } from "./lib/offerCode";
import { TermsGate } from "./components/Terms";
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
import ClassTest from "./pages/ClassTest";
import TestResults from "./pages/TestResults";
import MemberResult from "./pages/MemberResult";
import Invite from "./pages/Invite";
import Join, { type JoinResult } from "./pages/Join";
import Upgrade from "./pages/Upgrade";

const UserContext = createContext<User | null>(null);
export const useUser = () => useContext(UserContext)!;
/** null when signed out: only for the pages that also work signed out (a public deck's practice setup). */
export const useMaybeUser = () => useContext(UserContext);

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
  // Pages anyone can open without signing in: a group member's test, a class link (which asks for Google sign-in
  // itself), a friend's challenge, a public test link, a question post, and the plan comparison.
  const { pathname } = useLocation();
  // Time on site, for anyone signed in, on every page: link pages included.
  useActivityHeartbeat();
  if (["/t/", "/class/", "/c/", "/play/", "/p/", "/quiz/", "/q/", "/question/"].some((p) => pathname.startsWith(p)) || pathname === "/plans") {
    return (
      <Routes>
        <Route path="/t/:token" element={<TakeTest />} />
        <Route path="/class/:token" element={<ClassTest />} />
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
  const location = useLocation();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  // A ref, since navigate changes on every route change and refresh must not.
  const navigate = useRef(useNavigate());
  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const refresh = useCallback(() => {
    getAccount(pendingInvite()?.token, pendingRef() ?? undefined, pendingTerms() ?? undefined)
      .then(async (a) => {
        clearInvite(); // the server has seen it; it only counts for a brand new account anyway
        clearRef(); // same: only a brand new account is tagged
        clearTerms(); // recorded on the account
        // An offer code entered on the /join form: redeem it now, then show how it went on /join.
        const code = pendingOfferCode();
        clearOfferCode();
        let joined: JoinResult | null = null;
        if (code) {
          joined = await redeemOfferCode(code)
            .then((redeemed) => ({ code, redeemed }))
            .catch((e) => ({ code, error: (e as Error).message || "That offer code couldn't be redeemed." }));
          if ("redeemed" in joined) a = await getAccount().catch(() => a);
        }
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
        if (joined) return navigate.current("/join", { state: joined });
        // Already on that leaderboard from an earlier try: the link shows them that result, not this one.
        if (pub && (placed?.saved || placed?.already)) navigate.current(`/p/${pub.token}`);
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
  if (!user) {
    // A public deck's practice setup, opened from the sign-in page's list, works signed out. It asks the visitor to
    // sign in or sign up when they start, and starts the practice once they have.
    if (/^\/decks\/[^/]+\/practice\/?$/.test(location.pathname)) {
      return (
        <Routes>
          <Route path="/decks/:deckId/practice" element={<PracticeSetup />} />
        </Routes>
      );
    }
    return <Login />;
  }
  if (account && account.termsAccepted === false) return <TermsGate onAccepted={refresh} />;

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
        <Route path="/join" element={<Join />} />
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
