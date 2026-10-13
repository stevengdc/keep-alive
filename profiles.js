(() => {
  const SCHEMA_VERSION = 1;
  const ALLOWED_STRATEGIES = new Set(["authenticated-fetch", "activity", "apollo-refresh"]);

  const builtIns = [{
    schemaVersion: SCHEMA_VERSION,
    id: "global-trusted-sign-support",
    version: 1,
    name: "Global Trusted Sign Support",
    description: "Renova o token rotativo e o relógio interno da sessão através do cliente Apollo da aplicação.",
    matches: ["https://support.globaltrustedsign.com/*"],
    interval: { mode: "random", minMinutes: 4, maxMinutes: 7 },
    strategy: {
      type: "apollo-refresh",
      endpoint: "https://api.globaltrustedsign.com/graphql",
      operation: "refreshToken",
      field: "refreshToken",
      variable: "refresh_token",
      updateMethod: "changeSession",
      tokenFields: {
        access: "access_token",
        refresh: "refresh_token",
        expiresIn: "expires_in"
      }
    },
    detection: {
      requires: ["api.client.query", "methods.isLoggedIn", "methods.changeSession"]
    }
  }];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function validate(profile) {
    const errors = [];
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) errors.push("O perfil tem de ser um objeto.");
    if (profile?.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion tem de ser ${SCHEMA_VERSION}.`);
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(profile?.id || "")) errors.push("ID inválido.");
    if (typeof profile?.name !== "string" || !profile.name.trim()) errors.push("Nome em falta.");
    if (!Array.isArray(profile?.matches) || !profile.matches.length) errors.push("É necessário pelo menos um padrão matches.");
    for (const pattern of profile?.matches || []) {
      if (!/^https?:\/\/[^/]+\/\*$/.test(pattern)) errors.push(`Padrão não permitido: ${pattern}`);
    }
    if (!ALLOWED_STRATEGIES.has(profile?.strategy?.type)) errors.push("Estratégia não permitida.");
    const min = Number(profile?.interval?.minMinutes);
    const max = Number(profile?.interval?.maxMinutes);
    if (!(min >= 0.5 && max >= min && max <= 1440)) errors.push("Intervalo inválido.");
    if (profile?.strategy?.type === "apollo-refresh") {
      for (const key of ["operation", "field", "variable", "updateMethod"]) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(profile.strategy[key] || "")) errors.push(`Campo ${key} inválido.`);
      }
      try { new URL(profile.strategy.endpoint); } catch { errors.push("Endpoint Apollo inválido."); }
      for (const key of ["access", "refresh", "expiresIn"]) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(profile.strategy.tokenFields?.[key] || "")) {
          errors.push(`Campo tokenFields.${key} inválido.`);
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  function patternMatches(origin, pattern) {
    try {
      const expected = new URL(pattern.replace(/\/\*$/, "/"));
      return new URL(origin).origin === expected.origin;
    } catch {
      return false;
    }
  }

  function find(origin, customProfiles = []) {
    return [...customProfiles, ...builtIns].find((profile) =>
      profile.matches.some((pattern) => patternMatches(origin, pattern))
    ) || null;
  }

  globalThis.KeepAliveProfiles = {
    schemaVersion: SCHEMA_VERSION,
    builtIns: clone(builtIns),
    clone,
    find,
    validate
  };
})();
