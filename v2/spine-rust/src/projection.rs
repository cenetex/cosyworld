use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::types::ProjectionMutation;

#[derive(Clone, Copy, Debug)]
pub struct MutationCtx {
    pub actor_id: u64,
    pub tick: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectionError {
    pub projection: String,
    pub reason: String,
}

pub trait Projection: Send + 'static {
    fn id(&self) -> &'static str;
    fn as_any(&self) -> &dyn std::any::Any;
    fn schema_version(&self) -> u32;
    fn check(&self, mutation: &ProjectionMutation, ctx: MutationCtx) -> Result<(), String>;
    fn apply(&mut self, mutation: &ProjectionMutation, ctx: MutationCtx) -> Result<(), String>;
    fn snapshot(&self) -> serde_json::Value;
    fn restore(&mut self, version: u32, data: serde_json::Value) -> Result<(), String>;
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProjectionSnapshot {
    pub version: u32,
    pub data: serde_json::Value,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct RegistrySnapshot {
    pub projections: BTreeMap<String, ProjectionSnapshot>,
    #[serde(default)]
    pub claims: BTreeSet<String>,
}

#[derive(Default)]
pub struct ProjectionRegistry {
    projections: BTreeMap<&'static str, Box<dyn Projection>>,
    claims: BTreeSet<String>,
}

impl ProjectionRegistry {
    pub fn register(&mut self, projection: Box<dyn Projection>) {
        self.projections.insert(projection.id(), projection);
    }

    pub fn get<P: 'static>(&self, id: &str) -> Option<&P> {
        self.projections
            .get(id)
            .and_then(|p| p.as_any().downcast_ref::<P>())
    }

    pub fn check_all(
        &self,
        mutations: &[ProjectionMutation],
        ctx: MutationCtx,
    ) -> Result<(), ProjectionError> {
        for mutation in mutations {
            if self.is_claimed(mutation) {
                continue;
            }
            let projection = self
                .projections
                .get(mutation.projection.as_str())
                .ok_or_else(|| ProjectionError {
                    projection: mutation.projection.clone(),
                    reason: "unknown projection".to_string(),
                })?;
            projection
                .check(mutation, ctx)
                .map_err(|reason| ProjectionError {
                    projection: mutation.projection.clone(),
                    reason,
                })?;
        }
        Ok(())
    }

    pub fn apply_all(&mut self, mutations: &[ProjectionMutation], ctx: MutationCtx) {
        for mutation in mutations {
            if self.is_claimed(mutation) {
                continue;
            }
            let projection = self
                .projections
                .get_mut(mutation.projection.as_str())
                .expect("check_all ran before kernel commit");
            projection
                .apply(mutation, ctx)
                .expect("check_all validated this mutation");
            if let Some(key) = &mutation.claim_key {
                self.claims.insert(key.clone());
            }
        }
    }

    fn is_claimed(&self, mutation: &ProjectionMutation) -> bool {
        mutation
            .claim_key
            .as_ref()
            .is_some_and(|key| self.claims.contains(key))
    }

    pub fn claimed(&self, key: &str) -> bool {
        self.claims.contains(key)
    }

    pub fn snapshot(&self) -> RegistrySnapshot {
        RegistrySnapshot {
            projections: self
                .projections
                .iter()
                .map(|(id, p)| {
                    (
                        id.to_string(),
                        ProjectionSnapshot {
                            version: p.schema_version(),
                            data: p.snapshot(),
                        },
                    )
                })
                .collect(),
            claims: self.claims.clone(),
        }
    }

    pub fn restore(&mut self, snapshot: &RegistrySnapshot) -> Result<(), ProjectionError> {
        for (id, snap) in &snapshot.projections {
            let projection =
                self.projections
                    .get_mut(id.as_str())
                    .ok_or_else(|| ProjectionError {
                        projection: id.clone(),
                        reason: "snapshot references unregistered projection".to_string(),
                    })?;
            projection
                .restore(snap.version, snap.data.clone())
                .map_err(|reason| ProjectionError {
                    projection: id.clone(),
                    reason,
                })?;
        }
        self.claims = snapshot.claims.clone();
        Ok(())
    }
}

#[derive(Default)]
pub struct LedgerProjection {
    balances: BTreeMap<u64, i64>,
}

impl LedgerProjection {
    pub fn balance(&self, actor_id: u64) -> i64 {
        self.balances.get(&actor_id).copied().unwrap_or(0)
    }
}

impl Projection for LedgerProjection {
    fn id(&self) -> &'static str {
        "ledger"
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn schema_version(&self) -> u32 {
        1
    }

    fn check(&self, mutation: &ProjectionMutation, _ctx: MutationCtx) -> Result<(), String> {
        match mutation.op.as_str() {
            "mint" => {
                let amount = mutation.payload["amount"].as_i64().unwrap_or(0);
                if amount <= 0 {
                    return Err("mint amount must be positive".to_string());
                }
                Ok(())
            }
            "spend" => {
                let actor = mutation.payload["actor"].as_u64().unwrap_or(0);
                let amount = mutation.payload["amount"].as_i64().unwrap_or(0);
                if amount <= 0 {
                    return Err("spend amount must be positive".to_string());
                }
                if self.balance(actor) < amount {
                    return Err(format!(
                        "spend of {amount} exceeds balance {}",
                        self.balance(actor)
                    ));
                }
                Ok(())
            }
            other => Err(format!("unknown ledger op '{other}'")),
        }
    }

    fn apply(&mut self, mutation: &ProjectionMutation, _ctx: MutationCtx) -> Result<(), String> {
        let actor = mutation.payload["actor"].as_u64().unwrap_or(0);
        let amount = mutation.payload["amount"].as_i64().unwrap_or(0);
        let balance = self.balances.entry(actor).or_insert(0);
        match mutation.op.as_str() {
            "mint" => *balance += amount,
            "spend" => *balance -= amount,
            other => return Err(format!("unknown ledger op '{other}'")),
        }
        Ok(())
    }

    fn snapshot(&self) -> serde_json::Value {
        serde_json::json!({ "balances": self.balances })
    }

    fn restore(&mut self, version: u32, data: serde_json::Value) -> Result<(), String> {
        if version != self.schema_version() {
            return Err(format!(
                "ledger snapshot version {version} != {}",
                self.schema_version()
            ));
        }
        self.balances = serde_json::from_value(data["balances"].clone())
            .map_err(|e| format!("corrupt ledger snapshot: {e}"))?;
        Ok(())
    }
}

#[derive(Default)]
pub struct ClocksProjection {
    clocks: BTreeMap<String, ClockState>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClockState {
    pub size: u8,
    pub filled: u8,
}

impl ClocksProjection {
    pub fn clock(&self, id: &str) -> Option<&ClockState> {
        self.clocks.get(id)
    }
}

impl Projection for ClocksProjection {
    fn id(&self) -> &'static str {
        "clocks"
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn schema_version(&self) -> u32 {
        1
    }

    fn check(&self, mutation: &ProjectionMutation, _ctx: MutationCtx) -> Result<(), String> {
        match mutation.op.as_str() {
            "declare" => {
                let size = mutation.payload["size"].as_u64().unwrap_or(0);
                if size == 0 || size > u8::MAX as u64 {
                    return Err("clock size must fit in u8 and be positive".to_string());
                }
                Ok(())
            }
            "advance" => {
                let id = mutation.payload["id"].as_str().unwrap_or("");
                match self.clocks.get(id) {
                    None => Err(format!("clock '{id}' is not declared")),
                    Some(clock) if clock.filled >= clock.size => {
                        Err(format!("clock '{id}' is already complete"))
                    }
                    Some(_) => Ok(()),
                }
            }
            other => Err(format!("unknown clocks op '{other}'")),
        }
    }

    fn apply(&mut self, mutation: &ProjectionMutation, _ctx: MutationCtx) -> Result<(), String> {
        let id = mutation.payload["id"]
            .as_str()
            .ok_or("clock mutation missing id")?
            .to_string();
        match mutation.op.as_str() {
            "declare" => {
                let size = mutation.payload["size"].as_u64().unwrap_or(0) as u8;
                self.clocks
                    .entry(id)
                    .or_insert(ClockState { size, filled: 0 });
            }
            "advance" => {
                let amount = mutation.payload["amount"].as_u64().unwrap_or(1) as u8;
                let clock = self
                    .clocks
                    .get_mut(&id)
                    .ok_or_else(|| format!("clock '{id}' is not declared"))?;
                clock.filled = clock.filled.saturating_add(amount).min(clock.size);
            }
            other => return Err(format!("unknown clocks op '{other}'")),
        }
        Ok(())
    }

    fn snapshot(&self) -> serde_json::Value {
        serde_json::json!({ "clocks": self.clocks })
    }

    fn restore(&mut self, version: u32, data: serde_json::Value) -> Result<(), String> {
        if version != self.schema_version() {
            return Err(format!(
                "clocks snapshot version {version} != {}",
                self.schema_version()
            ));
        }
        self.clocks = serde_json::from_value(data["clocks"].clone())
            .map_err(|e| format!("corrupt clocks snapshot: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> MutationCtx {
        MutationCtx {
            actor_id: 1,
            tick: 0,
        }
    }

    fn mint(actor: u64, amount: i64, claim: &str) -> ProjectionMutation {
        ProjectionMutation {
            projection: "ledger".to_string(),
            op: "mint".to_string(),
            payload: serde_json::json!({ "actor": actor, "amount": amount }),
            claim_key: Some(claim.to_string()),
        }
    }

    fn registry() -> ProjectionRegistry {
        let mut r = ProjectionRegistry::default();
        r.register(Box::new(LedgerProjection::default()));
        r.register(Box::new(ClocksProjection::default()));
        r
    }

    #[test]
    fn claim_keyed_mint_is_idempotent() {
        let mut r = registry();
        let m = mint(7, 5, "listen:7:clock:1");
        r.check_all(std::slice::from_ref(&m), ctx()).unwrap();
        r.apply_all(std::slice::from_ref(&m), ctx());
        r.apply_all(&[m], ctx());
        let ledger: &LedgerProjection = r.get("ledger").unwrap();
        assert_eq!(ledger.balance(7), 5);
        assert!(r.claimed("listen:7:clock:1"));
    }

    #[test]
    fn overspend_fails_preflight() {
        let r = registry();
        let spend = ProjectionMutation {
            projection: "ledger".to_string(),
            op: "spend".to_string(),
            payload: serde_json::json!({ "actor": 7, "amount": 3 }),
            claim_key: Some("image:7:1".to_string()),
        };
        let err = r.check_all(&[spend], ctx()).unwrap_err();
        assert_eq!(err.projection, "ledger");
    }

    #[test]
    fn snapshot_round_trip_preserves_balances_and_claims() {
        let mut r = registry();
        let m = mint(7, 9, "mint:1");
        r.apply_all(&[m], ctx());
        let snap = r.snapshot();

        let mut restored = registry();
        restored.restore(&snap).unwrap();
        let ledger: &LedgerProjection = restored.get("ledger").unwrap();
        assert_eq!(ledger.balance(7), 9);
        assert!(restored.claimed("mint:1"));
    }

    #[test]
    fn restore_rejects_schema_mismatch() {
        let mut r = registry();
        let mut snap = r.snapshot();
        snap.projections.get_mut("ledger").unwrap().version = 99;
        assert!(r.restore(&snap).is_err());
    }

    #[test]
    fn clocks_complete_exactly_once() {
        let mut r = registry();
        let declare = ProjectionMutation {
            projection: "clocks".to_string(),
            op: "declare".to_string(),
            payload: serde_json::json!({ "id": "danger:moonlit", "size": 4 }),
            claim_key: None,
        };
        r.apply_all(&[declare], ctx());
        let advance = ProjectionMutation {
            projection: "clocks".to_string(),
            op: "advance".to_string(),
            payload: serde_json::json!({ "id": "danger:moonlit", "amount": 10 }),
            claim_key: None,
        };
        r.apply_all(std::slice::from_ref(&advance), ctx());
        let clocks: &ClocksProjection = r.get("clocks").unwrap();
        assert_eq!(
            clocks.clock("danger:moonlit"),
            Some(&ClockState { size: 4, filled: 4 })
        );
        assert!(
            r.check_all(&[advance], ctx()).is_err(),
            "completed clocks reject further advance"
        );
    }
}
