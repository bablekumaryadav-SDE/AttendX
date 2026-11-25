import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  loginUser,
  getCurrentUser,
} from "../services/auth";
import { getMyCollegeMemberships } from "../services/tenant";
import {
  COLLEGE_SELECTION_KEY,
  confirmedSelectionChange,
  getSingleFlightForIdentity,
  membershipLoadMessage,
  membershipIdentity,
  resolveConfirmedCollege,
} from "../services/tenantSelection";

const AuthContext = createContext(null);

const TOKEN_KEY = "attendx_token";
const USER_KEY = "attendx_user";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [collegeMemberships, setCollegeMemberships] = useState([]);
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [membershipsError, setMembershipsError] = useState(null);
  const [activeCollegeId, setActiveCollegeId] = useState(null);
  const [membershipReloadVersion, setMembershipReloadVersion] = useState(0);
  const membershipRequestRef = useRef(null);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(COLLEGE_SELECTION_KEY);
    setUser(null);
    setCollegeMemberships([]);
    setActiveCollegeId(null);
    setMembershipsError(null);
    setMembershipsLoading(false);
    membershipRequestRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setCollegeMemberships([]);
      setActiveCollegeId(null);
      setMembershipsError(null);
      setMembershipsLoading(false);
      return undefined;
    }

    setMembershipsLoading(true);
    setMembershipsError(null);
    const requestIdentity = membershipIdentity(user);
    if (!requestIdentity) {
      setCollegeMemberships([]);
      setActiveCollegeId(null);
      setMembershipsError({ status: null, message: "The signed-in profile is missing its account identity. Sign in again to continue." });
      setMembershipsLoading(false);
      return undefined;
    }
    const request = getSingleFlightForIdentity(
      membershipRequestRef,
      requestIdentity,
      getMyCollegeMemberships
    );

    async function loadMemberships() {
      try {
        const items = await request.promise;
        if (cancelled) return;
        if (!Array.isArray(items)) {
          throw new Error("The College membership service returned an unexpected response.");
        }
        const safeItems = items;
        const confirmedId = resolveConfirmedCollege(
          safeItems,
          localStorage.getItem(COLLEGE_SELECTION_KEY)
        );
        setCollegeMemberships(safeItems);
        setActiveCollegeId(confirmedId);
        if (confirmedId) localStorage.setItem(COLLEGE_SELECTION_KEY, confirmedId);
        else localStorage.removeItem(COLLEGE_SELECTION_KEY);
      } catch (error) {
        if (cancelled) return;
        setCollegeMemberships([]);
        setActiveCollegeId(null);
        localStorage.removeItem(COLLEGE_SELECTION_KEY);
        setMembershipsError({
          status: error.response?.status,
          message: error.response?.status
            ? membershipLoadMessage(error.response.status, error.code)
            : error.message?.includes("unexpected response")
              ? error.message
              : membershipLoadMessage(null, error.code),
        });
      } finally {
        if (membershipRequestRef.current === request) membershipRequestRef.current = null;
        if (!cancelled) setMembershipsLoading(false);
      }
    }
    void loadMemberships();

    return () => { cancelled = true; };
  }, [user?.id, user?.user_id, user?.email, user?.role, membershipReloadVersion]);

  const reloadMemberships = useCallback(() => {
    if (!user || membershipsLoading) return;
    membershipRequestRef.current = null;
    setMembershipsError(null);
    setCollegeMemberships([]);
    setActiveCollegeId(null);
    setMembershipsLoading(true);
    setMembershipReloadVersion((current) => current + 1);
  }, [user, membershipsLoading]);

  const selectCollege = useCallback((collegeId) => {
    const selection = confirmedSelectionChange(activeCollegeId, collegeId, collegeMemberships);
    if (!selection.selectedId) return false;
    if (selection.changed) {
      setActiveCollegeId(selection.selectedId);
      localStorage.setItem(COLLEGE_SELECTION_KEY, selection.selectedId);
      window.dispatchEvent(new CustomEvent("attendx:college-changed", { detail: { collegeId: selection.selectedId } }));
    }
    return true;
  }, [activeCollegeId, collegeMemberships]);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const token = localStorage.getItem(TOKEN_KEY);

      if (!token) {
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
        return;
      }

      try {
        const profile = await getCurrentUser(token);

        if (!cancelled) {
          setMembershipsLoading(true);
          setUser(profile);
          localStorage.setItem(USER_KEY, JSON.stringify(profile));
        }
      } catch (error) {
        if (!cancelled) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setUser(null);
          setMembershipsLoading(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const response = await loginUser(email, password);
    const token = response?.access_token;

    if (!token) {
      throw new Error("Login response mein access_token nahi mila.");
    }

    localStorage.setItem(TOKEN_KEY, token);

    try {
      const profile = await getCurrentUser(token);

      setMembershipsLoading(true);
      membershipRequestRef.current = null;
      setMembershipReloadVersion((current) => current + 1);
      setCollegeMemberships([]);
      setActiveCollegeId(null);
      setUser(profile);
      localStorage.setItem(USER_KEY, JSON.stringify(profile));

      return profile;
    } catch (error) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      setUser(null);
      setMembershipsLoading(false);
      throw error;
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      currentUser: user,
      loading,
      isAuthenticated: Boolean(user),
      login,
      logout,
      collegeMemberships,
      membershipsLoading,
      membershipsError,
      reloadMemberships,
      activeCollegeId,
      selectCollege,
    }),
    [user, loading, login, logout, collegeMemberships, membershipsLoading, membershipsError, reloadMemberships, activeCollegeId, selectCollege]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth ko AuthProvider ke andar use karna zaroori hai."
    );
  }

  return context;
}

export default AuthContext;
