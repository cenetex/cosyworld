use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    sync::Arc,
};

pub(crate) const AI_REGISTRY_ENV: &str = "COSYWORLD_AI_REGISTRY_JSON";
pub(crate) const AI_CAPABILITY_MODELS_ENV: &str = "COSYWORLD_AI_CAPABILITY_MODELS_JSON";
const REGISTRY_SCHEMA_VERSION: u32 = 1;
const ATTRIBUTION_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ModelCapability {
    Voice,
    IntentJson,
    WorldContent,
}

impl ModelCapability {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Voice => "voice",
            Self::IntentJson => "intent_json",
            Self::WorldContent => "world_content",
        }
    }
}

impl fmt::Display for ModelCapability {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ModelModality {
    Text,
    Image,
    Audio,
    Video,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DataRetention {
    None,
    Limited,
    ProviderDefault,
    #[default]
    Unknown,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TrainingUse {
    Prohibited,
    ContractualOptOut,
    Permitted,
    #[default]
    Unknown,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DataPolicyEligibility {
    #[serde(default)]
    pub(crate) retention: DataRetention,
    #[serde(default)]
    pub(crate) training: TrainingUse,
}

impl DataPolicyEligibility {
    fn production_eligible(self) -> bool {
        self.retention == DataRetention::None
            && matches!(
                self.training,
                TrainingUse::Prohibited | TrainingUse::ContractualOptOut
            )
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) enum DataPolicyMode {
    #[default]
    Development,
    Production,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SupportedParameters {
    #[serde(default)]
    pub(crate) structured_output: bool,
    #[serde(default)]
    pub(crate) json_mode: bool,
    #[serde(default)]
    pub(crate) tools: bool,
    #[serde(default)]
    pub(crate) seed: bool,
    #[serde(default)]
    pub(crate) stop: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PromptAdapterRef {
    pub(crate) id: String,
    pub(crate) version: String,
}

impl Default for PromptAdapterRef {
    fn default() -> Self {
        Self {
            id: "openai-chat".to_string(),
            version: "1".to_string(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SamplingDefaults {
    #[serde(default)]
    pub(crate) temperature: Option<f64>,
    #[serde(default)]
    pub(crate) top_p: Option<f64>,
    #[serde(default)]
    pub(crate) seed: Option<u64>,
    #[serde(default)]
    pub(crate) stop: Vec<String>,
    #[serde(default = "default_hard_output_cap")]
    pub(crate) hard_output_cap: u32,
}

fn default_hard_output_cap() -> u32 {
    4_096
}

impl Default for SamplingDefaults {
    fn default() -> Self {
        Self {
            temperature: None,
            top_p: None,
            seed: None,
            stop: Vec::new(),
            hard_output_cap: default_hard_output_cap(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CapabilityGateHistory {
    #[serde(default)]
    pub(crate) passed: u64,
    #[serde(default)]
    pub(crate) failed: u64,
    #[serde(default)]
    pub(crate) last_gate_version: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CandidateObservations {
    #[serde(default)]
    pub(crate) input_cost_per_million: Option<f64>,
    #[serde(default)]
    pub(crate) output_cost_per_million: Option<f64>,
    #[serde(default)]
    pub(crate) latency_p50_ms: Option<u64>,
    #[serde(default)]
    pub(crate) availability_ratio: Option<f64>,
    #[serde(default)]
    pub(crate) gate_history: BTreeMap<ModelCapability, CapabilityGateHistory>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ConcreteModelIdentity {
    pub(crate) model_id: String,
    #[serde(default)]
    pub(crate) revision: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DeclaredModelCandidate {
    pub(crate) requested_model_id: String,
    pub(crate) provider: String,
    #[serde(default)]
    pub(crate) concrete_model: Option<ConcreteModelIdentity>,
    #[serde(default)]
    pub(crate) mutable_alias: bool,
    #[serde(default)]
    pub(crate) family: Option<String>,
    #[serde(default)]
    pub(crate) size_class: Option<String>,
    #[serde(default)]
    pub(crate) input_modalities: BTreeSet<ModelModality>,
    #[serde(default)]
    pub(crate) output_modalities: BTreeSet<ModelModality>,
    #[serde(default)]
    pub(crate) context_limit: Option<u32>,
    #[serde(default)]
    pub(crate) output_limit: Option<u32>,
    #[serde(default)]
    pub(crate) supported_parameters: SupportedParameters,
    #[serde(default)]
    pub(crate) data_policy: DataPolicyEligibility,
    #[serde(default)]
    pub(crate) prompt_adapter: PromptAdapterRef,
    #[serde(default)]
    pub(crate) sampling: SamplingDefaults,
    #[serde(default)]
    pub(crate) capabilities: BTreeSet<ModelCapability>,
    #[serde(default)]
    pub(crate) observations: CandidateObservations,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DiscoveredModelCandidate {
    pub(crate) requested_model_id: String,
    pub(crate) provider: String,
    #[serde(default)]
    pub(crate) concrete_model: Option<ConcreteModelIdentity>,
    #[serde(default)]
    pub(crate) family: Option<String>,
    #[serde(default)]
    pub(crate) size_class: Option<String>,
    #[serde(default)]
    pub(crate) input_modalities: BTreeSet<ModelModality>,
    #[serde(default)]
    pub(crate) output_modalities: BTreeSet<ModelModality>,
    #[serde(default)]
    pub(crate) context_limit: Option<u32>,
    #[serde(default)]
    pub(crate) output_limit: Option<u32>,
    #[serde(default)]
    pub(crate) supported_parameters: SupportedParameters,
    #[serde(default)]
    pub(crate) reported_capabilities: BTreeSet<ModelCapability>,
    #[serde(default)]
    pub(crate) observations: CandidateObservations,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CapabilityRegistryDocument {
    pub(crate) schema_version: u32,
    pub(crate) snapshot_version: String,
    #[serde(default)]
    pub(crate) declared: Vec<DeclaredModelCandidate>,
    #[serde(default)]
    pub(crate) discovered: Vec<DiscoveredModelCandidate>,
}

#[derive(Clone, Debug)]
pub(crate) struct ModelCandidate {
    requested_model_id: String,
    provider: String,
    concrete_model: Option<ConcreteModelIdentity>,
    mutable_alias: bool,
    family: Option<String>,
    size_class: Option<String>,
    input_modalities: BTreeSet<ModelModality>,
    output_modalities: BTreeSet<ModelModality>,
    context_limit: Option<u32>,
    output_limit: Option<u32>,
    supported_parameters: SupportedParameters,
    data_policy: DataPolicyEligibility,
    prompt_adapter: PromptAdapterRef,
    sampling: SamplingDefaults,
    declared_capabilities: BTreeSet<ModelCapability>,
    discovered_capabilities: BTreeSet<ModelCapability>,
    observations: CandidateObservations,
    declared: bool,
    discovered: bool,
}

impl ModelCandidate {
    pub(crate) fn requested_model_id(&self) -> &str {
        &self.requested_model_id
    }

    pub(crate) fn supported_parameters(&self) -> &SupportedParameters {
        &self.supported_parameters
    }

    pub(crate) fn sampling(&self) -> &SamplingDefaults {
        &self.sampling
    }

    pub(crate) fn output_limit(&self) -> Option<u32> {
        self.output_limit
    }

    pub(crate) fn provider(&self) -> &str {
        &self.provider
    }

    pub(crate) fn family(&self) -> Option<&str> {
        self.family.as_deref()
    }

    pub(crate) fn concrete_model(&self) -> Option<&ConcreteModelIdentity> {
        self.concrete_model.as_ref()
    }

    pub(crate) fn prompt_adapter(&self) -> &PromptAdapterRef {
        &self.prompt_adapter
    }

    pub(crate) fn observations(&self) -> &CandidateObservations {
        &self.observations
    }

    #[cfg(test)]
    fn declared_capabilities(&self) -> &BTreeSet<ModelCapability> {
        &self.declared_capabilities
    }

    #[cfg(test)]
    fn discovered_capabilities(&self) -> &BTreeSet<ModelCapability> {
        &self.discovered_capabilities
    }

    #[cfg(test)]
    fn is_declared(&self) -> bool {
        self.declared
    }

    #[cfg(test)]
    fn is_discovered(&self) -> bool {
        self.discovered
    }

    fn supports(&self, capability: ModelCapability) -> bool {
        self.declared_capabilities.contains(&capability)
            && self.input_modalities.contains(&ModelModality::Text)
            && self.output_modalities.contains(&ModelModality::Text)
            && match capability {
                ModelCapability::Voice => true,
                ModelCapability::IntentJson => {
                    self.supported_parameters.json_mode
                        || self.supported_parameters.structured_output
                }
                ModelCapability::WorldContent => self.supported_parameters.structured_output,
            }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct CapabilityRegistrySnapshot {
    snapshot_version: String,
    candidates: BTreeMap<String, Arc<ModelCandidate>>,
    pools: BTreeMap<ModelCapability, Vec<String>>,
}

impl Default for CapabilityRegistrySnapshot {
    fn default() -> Self {
        Self {
            snapshot_version: "unconfigured".to_string(),
            candidates: BTreeMap::new(),
            pools: BTreeMap::new(),
        }
    }
}

impl CapabilityRegistrySnapshot {
    pub(crate) fn from_json(value: &str) -> Result<Self, RegistryError> {
        let document = serde_json::from_str::<CapabilityRegistryDocument>(value)
            .map_err(|error| RegistryError::InvalidDocument(error.to_string()))?;
        Self::from_document(document)
    }

    pub(crate) fn from_document(
        document: CapabilityRegistryDocument,
    ) -> Result<Self, RegistryError> {
        if document.schema_version != REGISTRY_SCHEMA_VERSION {
            return Err(RegistryError::UnsupportedSchema(document.schema_version));
        }
        let snapshot_version =
            normalize_token(&document.snapshot_version, "registry snapshot version", 128)?;
        let mut candidates = BTreeMap::<String, ModelCandidate>::new();

        for discovered in document.discovered {
            let normalized = normalize_discovered(discovered)?;
            let key = normalized.requested_model_id.clone();
            if candidates.insert(key.clone(), normalized).is_some() {
                return Err(RegistryError::DuplicateCandidate(key));
            }
        }

        for declared in document.declared {
            let normalized = normalize_declared(declared)?;
            let key = normalized.requested_model_id.clone();
            if let Some(discovered) = candidates.remove(&key) {
                if discovered.declared {
                    return Err(RegistryError::DuplicateCandidate(key));
                }
                if discovered.provider != normalized.provider {
                    return Err(RegistryError::ProviderMismatch {
                        model: key,
                        declared: normalized.provider,
                        discovered: discovered.provider,
                    });
                }
                candidates.insert(key, merge_declared_and_discovered(normalized, discovered));
            } else {
                candidates.insert(key, normalized);
            }
        }

        let candidates = candidates
            .into_iter()
            .map(|(key, candidate)| (key, Arc::new(candidate)))
            .collect::<BTreeMap<_, _>>();
        let mut pools = BTreeMap::<ModelCapability, Vec<String>>::new();
        for (key, candidate) in &candidates {
            for capability in [
                ModelCapability::Voice,
                ModelCapability::IntentJson,
                ModelCapability::WorldContent,
            ] {
                if candidate.supports(capability) {
                    pools.entry(capability).or_default().push(key.clone());
                } else if candidate.declared_capabilities.contains(&capability) {
                    return Err(RegistryError::UnsupportedDeclaredCapability {
                        model: key.clone(),
                        capability,
                    });
                }
            }
        }

        Ok(Self {
            snapshot_version,
            candidates,
            pools,
        })
    }

    pub(crate) fn legacy(
        snapshot_version: impl Into<String>,
        provider: &str,
        model: &str,
    ) -> Result<Self, RegistryError> {
        Self::from_document(CapabilityRegistryDocument {
            schema_version: REGISTRY_SCHEMA_VERSION,
            snapshot_version: snapshot_version.into(),
            declared: vec![DeclaredModelCandidate {
                requested_model_id: model.to_string(),
                provider: provider.to_string(),
                concrete_model: Some(ConcreteModelIdentity {
                    model_id: model.to_string(),
                    revision: None,
                }),
                mutable_alias: false,
                family: None,
                size_class: None,
                input_modalities: BTreeSet::from([ModelModality::Text]),
                output_modalities: BTreeSet::from([ModelModality::Text]),
                context_limit: None,
                output_limit: None,
                supported_parameters: SupportedParameters {
                    structured_output: true,
                    json_mode: true,
                    tools: false,
                    seed: false,
                    stop: true,
                },
                data_policy: DataPolicyEligibility::default(),
                prompt_adapter: PromptAdapterRef::default(),
                sampling: SamplingDefaults::default(),
                capabilities: BTreeSet::from([
                    ModelCapability::Voice,
                    ModelCapability::IntentJson,
                    ModelCapability::WorldContent,
                ]),
                observations: CandidateObservations::default(),
            }],
            discovered: Vec::new(),
        })
    }

    #[cfg(test)]
    pub(crate) fn candidate_count(&self) -> usize {
        self.candidates.len()
    }

    #[cfg(test)]
    pub(crate) fn pool_len(&self, capability: ModelCapability) -> usize {
        self.pools
            .get(&capability)
            .map(Vec::len)
            .unwrap_or_default()
    }

    pub(crate) fn first_model_for(&self, capability: ModelCapability) -> Option<&str> {
        self.pools
            .get(&capability)
            .and_then(|pool| pool.first())
            .map(String::as_str)
    }

    pub(crate) fn pin(
        &self,
        capability: ModelCapability,
        requested_model: Option<&str>,
        policy_mode: DataPolicyMode,
    ) -> Result<PinnedModelSelection, RegistryError> {
        let pool = self.pools.get(&capability);
        let key = match requested_model
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(requested) => {
                let candidate = self
                    .candidates
                    .get(requested)
                    .ok_or_else(|| RegistryError::UnknownCandidate(requested.to_string()))?;
                if !candidate.supports(capability) {
                    return Err(RegistryError::CapabilityMismatch {
                        model: requested.to_string(),
                        capability,
                    });
                }
                requested
            }
            None => pool
                .and_then(|models| models.first())
                .map(String::as_str)
                .ok_or(RegistryError::EmptyCapabilityPool(capability))?,
        };
        let candidate = self
            .candidates
            .get(key)
            .cloned()
            .ok_or_else(|| RegistryError::UnknownCandidate(key.to_string()))?;
        if policy_mode == DataPolicyMode::Production && !candidate.data_policy.production_eligible()
        {
            return Err(RegistryError::PrivacyRejected {
                model: key.to_string(),
            });
        }
        Ok(PinnedModelSelection {
            snapshot_version: self.snapshot_version.clone(),
            capability,
            candidate,
        })
    }

    pub(crate) fn pin_all(
        &self,
        capability: ModelCapability,
        policy_mode: DataPolicyMode,
    ) -> Result<Vec<PinnedModelSelection>, RegistryError> {
        let mut pinned = Vec::new();
        for model in self
            .pools
            .get(&capability)
            .ok_or(RegistryError::EmptyCapabilityPool(capability))?
        {
            match self.pin(capability, Some(model), policy_mode) {
                Ok(selection) => pinned.push(selection),
                Err(RegistryError::PrivacyRejected { .. }) => {}
                Err(error) => return Err(error),
            }
        }
        if pinned.is_empty() {
            return Err(RegistryError::EmptyCapabilityPool(capability));
        }
        Ok(pinned)
    }

    #[cfg(test)]
    pub(crate) fn inspect_historical(
        &self,
        attribution: ModelAttribution,
    ) -> HistoricalModelInspection {
        let known_in_current_snapshot = self
            .candidates
            .contains_key(&attribution.requested_model_id)
            || self.candidates.values().any(|candidate| {
                candidate
                    .concrete_model
                    .as_ref()
                    .is_some_and(|identity| identity.model_id == attribution.resolved_model_id)
            });
        HistoricalModelInspection {
            attribution,
            known_in_current_snapshot,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct PinnedModelSelection {
    snapshot_version: String,
    capability: ModelCapability,
    candidate: Arc<ModelCandidate>,
}

impl PinnedModelSelection {
    pub(crate) fn requested_model_id(&self) -> &str {
        self.candidate.requested_model_id()
    }

    pub(crate) fn candidate(&self) -> &ModelCandidate {
        &self.candidate
    }

    pub(crate) fn attribute_response(
        &self,
        provider_model: Option<&str>,
    ) -> Result<ModelAttribution, RegistryError> {
        let returned = provider_model
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| normalize_model_id(value, "provider returned model"))
            .transpose()?;
        let resolved_model_id = if self.candidate.mutable_alias {
            let returned = returned.ok_or_else(|| RegistryError::AliasUnresolved {
                alias: self.candidate.requested_model_id.clone(),
            })?;
            if returned == self.candidate.requested_model_id {
                return Err(RegistryError::AliasUnresolved {
                    alias: self.candidate.requested_model_id.clone(),
                });
            }
            returned
        } else {
            returned
                .or_else(|| {
                    self.candidate
                        .concrete_model
                        .as_ref()
                        .map(|identity| identity.model_id.clone())
                })
                .unwrap_or_else(|| self.candidate.requested_model_id.clone())
        };
        let resolved_revision = self
            .candidate
            .concrete_model
            .as_ref()
            .filter(|identity| identity.model_id == resolved_model_id)
            .and_then(|identity| identity.revision.clone());
        Ok(ModelAttribution {
            schema_version: ATTRIBUTION_SCHEMA_VERSION,
            catalog_snapshot_version: self.snapshot_version.clone(),
            capability: self.capability,
            requested_model_id: self.candidate.requested_model_id.clone(),
            resolved_model_id,
            resolved_revision,
            provider: self.candidate.provider.clone(),
            family: self.candidate.family.clone(),
            size_class: self.candidate.size_class.clone(),
            prompt_adapter_id: self.candidate.prompt_adapter.id.clone(),
            prompt_adapter_version: self.candidate.prompt_adapter.version.clone(),
            data_policy: self.candidate.data_policy,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ModelAttribution {
    pub(crate) schema_version: u32,
    pub(crate) catalog_snapshot_version: String,
    pub(crate) capability: ModelCapability,
    pub(crate) requested_model_id: String,
    pub(crate) resolved_model_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) resolved_revision: Option<String>,
    pub(crate) provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) size_class: Option<String>,
    pub(crate) prompt_adapter_id: String,
    pub(crate) prompt_adapter_version: String,
    pub(crate) data_policy: DataPolicyEligibility,
}

#[cfg(test)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HistoricalModelInspection {
    pub(crate) attribution: ModelAttribution,
    pub(crate) known_in_current_snapshot: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum RegistryError {
    InvalidDocument(String),
    UnsupportedSchema(u32),
    InvalidField {
        field: &'static str,
        detail: String,
    },
    DuplicateCandidate(String),
    ProviderMismatch {
        model: String,
        declared: String,
        discovered: String,
    },
    UnsupportedDeclaredCapability {
        model: String,
        capability: ModelCapability,
    },
    UnknownCandidate(String),
    CapabilityMismatch {
        model: String,
        capability: ModelCapability,
    },
    EmptyCapabilityPool(ModelCapability),
    PrivacyRejected {
        model: String,
    },
    AliasUnresolved {
        alias: String,
    },
}

impl RegistryError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::PrivacyRejected { .. } => "inference_privacy_rejected",
            Self::CapabilityMismatch { .. }
            | Self::EmptyCapabilityPool(_)
            | Self::UnsupportedDeclaredCapability { .. } => "inference_capability_mismatch",
            Self::AliasUnresolved { .. } => "inference_alias_unresolved",
            _ => "inference_registry_error",
        }
    }
}

impl fmt::Display for RegistryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDocument(detail) => write!(formatter, "invalid capability registry: {detail}"),
            Self::UnsupportedSchema(version) => write!(
                formatter,
                "unsupported capability registry schema {version}; expected {REGISTRY_SCHEMA_VERSION}"
            ),
            Self::InvalidField { field, detail } => write!(formatter, "invalid {field}: {detail}"),
            Self::DuplicateCandidate(model) => {
                write!(formatter, "capability registry repeats candidate {model:?}")
            }
            Self::ProviderMismatch {
                model,
                declared,
                discovered,
            } => write!(
                formatter,
                "declared provider {declared:?} for {model:?} does not match discovered provider {discovered:?}"
            ),
            Self::UnsupportedDeclaredCapability { model, capability } => write!(
                formatter,
                "candidate {model:?} declares {capability} without its required normalized modalities or parameters"
            ),
            Self::UnknownCandidate(model) => {
                write!(formatter, "capability registry does not contain candidate {model:?}")
            }
            Self::CapabilityMismatch { model, capability } => {
                write!(formatter, "candidate {model:?} is not eligible for {capability}")
            }
            Self::EmptyCapabilityPool(capability) => {
                write!(formatter, "capability registry has no {capability} candidates")
            }
            Self::PrivacyRejected { model } => write!(
                formatter,
                "candidate {model:?} lacks explicit production no-retention/no-training eligibility"
            ),
            Self::AliasUnresolved { alias } => write!(
                formatter,
                "provider did not attribute mutable alias {alias:?} to a concrete returned model"
            ),
        }
    }
}

impl std::error::Error for RegistryError {}

fn normalize_declared(value: DeclaredModelCandidate) -> Result<ModelCandidate, RegistryError> {
    let requested_model_id = normalize_model_id(&value.requested_model_id, "requested model id")?;
    let provider = normalize_provider(&value.provider)?;
    let concrete_model = value
        .concrete_model
        .map(normalize_concrete_identity)
        .transpose()?;
    if value.mutable_alias && concrete_model.is_some() {
        return Err(RegistryError::InvalidField {
            field: "mutable alias",
            detail: format!("{requested_model_id:?} cannot also declare a fixed concrete model"),
        });
    }
    validate_candidate_values(
        &requested_model_id,
        &value.input_modalities,
        &value.output_modalities,
        value.context_limit,
        value.output_limit,
        &value.supported_parameters,
        &value.prompt_adapter,
        &value.sampling,
        &value.observations,
    )?;
    Ok(ModelCandidate {
        requested_model_id,
        provider,
        concrete_model,
        mutable_alias: value.mutable_alias,
        family: normalize_optional_token(value.family, "model family", 128)?,
        size_class: normalize_optional_token(value.size_class, "model size class", 64)?,
        input_modalities: value.input_modalities,
        output_modalities: value.output_modalities,
        context_limit: value.context_limit,
        output_limit: value.output_limit,
        supported_parameters: value.supported_parameters,
        data_policy: value.data_policy,
        prompt_adapter: normalize_prompt_adapter(value.prompt_adapter)?,
        sampling: normalize_sampling(value.sampling)?,
        declared_capabilities: value.capabilities,
        discovered_capabilities: BTreeSet::new(),
        observations: value.observations,
        declared: true,
        discovered: false,
    })
}

fn normalize_discovered(value: DiscoveredModelCandidate) -> Result<ModelCandidate, RegistryError> {
    let requested_model_id = normalize_model_id(&value.requested_model_id, "requested model id")?;
    let provider = normalize_provider(&value.provider)?;
    let concrete_model = value
        .concrete_model
        .map(normalize_concrete_identity)
        .transpose()?;
    validate_candidate_values(
        &requested_model_id,
        &value.input_modalities,
        &value.output_modalities,
        value.context_limit,
        value.output_limit,
        &value.supported_parameters,
        &PromptAdapterRef::default(),
        &SamplingDefaults::default(),
        &value.observations,
    )?;
    Ok(ModelCandidate {
        requested_model_id,
        provider,
        concrete_model,
        mutable_alias: false,
        family: normalize_optional_token(value.family, "model family", 128)?,
        size_class: normalize_optional_token(value.size_class, "model size class", 64)?,
        input_modalities: value.input_modalities,
        output_modalities: value.output_modalities,
        context_limit: value.context_limit,
        output_limit: value.output_limit,
        supported_parameters: value.supported_parameters,
        data_policy: DataPolicyEligibility::default(),
        prompt_adapter: PromptAdapterRef::default(),
        sampling: SamplingDefaults::default(),
        declared_capabilities: BTreeSet::new(),
        discovered_capabilities: value.reported_capabilities,
        observations: value.observations,
        declared: false,
        discovered: true,
    })
}

fn merge_declared_and_discovered(
    mut declared: ModelCandidate,
    discovered: ModelCandidate,
) -> ModelCandidate {
    declared.discovered = true;
    declared.discovered_capabilities = discovered.discovered_capabilities;
    if declared.concrete_model.is_none() && !declared.mutable_alias {
        declared.concrete_model = discovered.concrete_model;
    }
    if declared.family.is_none() {
        declared.family = discovered.family;
    }
    if declared.size_class.is_none() {
        declared.size_class = discovered.size_class;
    }
    if declared.context_limit.is_none() {
        declared.context_limit = discovered.context_limit;
    }
    if declared.output_limit.is_none() {
        declared.output_limit = discovered.output_limit;
    }
    declared.observations = discovered.observations;
    declared
}

fn normalize_concrete_identity(
    value: ConcreteModelIdentity,
) -> Result<ConcreteModelIdentity, RegistryError> {
    Ok(ConcreteModelIdentity {
        model_id: normalize_model_id(&value.model_id, "concrete model id")?,
        revision: normalize_optional_token(value.revision, "model revision", 128)?,
    })
}

#[allow(clippy::too_many_arguments)]
fn validate_candidate_values(
    model: &str,
    input_modalities: &BTreeSet<ModelModality>,
    output_modalities: &BTreeSet<ModelModality>,
    context_limit: Option<u32>,
    output_limit: Option<u32>,
    supported_parameters: &SupportedParameters,
    prompt_adapter: &PromptAdapterRef,
    sampling: &SamplingDefaults,
    observations: &CandidateObservations,
) -> Result<(), RegistryError> {
    if input_modalities.is_empty() || output_modalities.is_empty() {
        return Err(RegistryError::InvalidField {
            field: "model modalities",
            detail: format!("{model:?} must declare non-empty input and output modalities"),
        });
    }
    if context_limit == Some(0) || output_limit == Some(0) {
        return Err(RegistryError::InvalidField {
            field: "model limits",
            detail: format!("{model:?} limits must be positive when known"),
        });
    }
    if let (Some(context), Some(output)) = (context_limit, output_limit) {
        if output > context {
            return Err(RegistryError::InvalidField {
                field: "model limits",
                detail: format!("{model:?} output limit exceeds its context limit"),
            });
        }
    }
    normalize_token(&prompt_adapter.id, "prompt adapter id", 128)?;
    normalize_token(&prompt_adapter.version, "prompt adapter version", 128)?;
    validate_sampling(model, sampling)?;
    if sampling.seed.is_some() && !supported_parameters.seed {
        return Err(RegistryError::InvalidField {
            field: "sampling seed",
            detail: format!("{model:?} configures a seed without declaring seed support"),
        });
    }
    if !sampling.stop.is_empty() && !supported_parameters.stop {
        return Err(RegistryError::InvalidField {
            field: "sampling stop",
            detail: format!("{model:?} configures stop sequences without declaring stop support"),
        });
    }
    for value in [
        observations.input_cost_per_million,
        observations.output_cost_per_million,
        observations.availability_ratio,
    ]
    .into_iter()
    .flatten()
    {
        if !value.is_finite() || value < 0.0 {
            return Err(RegistryError::InvalidField {
                field: "candidate observations",
                detail: format!("{model:?} contains a negative or non-finite observation"),
            });
        }
    }
    if observations
        .availability_ratio
        .is_some_and(|value| value > 1.0)
    {
        return Err(RegistryError::InvalidField {
            field: "candidate availability",
            detail: format!("{model:?} availability ratio must be at most 1"),
        });
    }
    Ok(())
}

fn normalize_prompt_adapter(value: PromptAdapterRef) -> Result<PromptAdapterRef, RegistryError> {
    Ok(PromptAdapterRef {
        id: normalize_token(&value.id, "prompt adapter id", 128)?,
        version: normalize_token(&value.version, "prompt adapter version", 128)?,
    })
}

fn normalize_sampling(value: SamplingDefaults) -> Result<SamplingDefaults, RegistryError> {
    validate_sampling("candidate", &value)?;
    let stop = value
        .stop
        .into_iter()
        .map(|stop| {
            let stop = stop.trim().to_string();
            if stop.is_empty() || stop.chars().count() > 128 || stop.chars().any(char::is_control) {
                Err(RegistryError::InvalidField {
                    field: "stop sequence",
                    detail: "stop sequences must be 1-128 visible characters".to_string(),
                })
            } else {
                Ok(stop)
            }
        })
        .collect::<Result<BTreeSet<_>, _>>()?
        .into_iter()
        .collect();
    Ok(SamplingDefaults { stop, ..value })
}

fn validate_sampling(model: &str, value: &SamplingDefaults) -> Result<(), RegistryError> {
    if value.hard_output_cap == 0 {
        return Err(RegistryError::InvalidField {
            field: "hard output cap",
            detail: format!("{model:?} hard output cap must be positive"),
        });
    }
    if value
        .temperature
        .is_some_and(|temperature| !temperature.is_finite() || !(0.0..=2.0).contains(&temperature))
    {
        return Err(RegistryError::InvalidField {
            field: "temperature",
            detail: format!("{model:?} temperature must be between 0 and 2"),
        });
    }
    if value
        .top_p
        .is_some_and(|top_p| !top_p.is_finite() || !(0.0..=1.0).contains(&top_p))
    {
        return Err(RegistryError::InvalidField {
            field: "top_p",
            detail: format!("{model:?} top_p must be between 0 and 1"),
        });
    }
    Ok(())
}

fn normalize_provider(value: &str) -> Result<String, RegistryError> {
    normalize_token(value, "provider", 64).map(|provider| provider.to_ascii_lowercase())
}

fn normalize_model_id(value: &str, field: &'static str) -> Result<String, RegistryError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 256
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "/._:@+-".contains(character))
    {
        return Err(RegistryError::InvalidField {
            field,
            detail: "must be 1-256 provider-safe ASCII characters".to_string(),
        });
    }
    Ok(value.to_string())
}

fn normalize_token(
    value: &str,
    field: &'static str,
    max_len: usize,
) -> Result<String, RegistryError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > max_len
        || value
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(RegistryError::InvalidField {
            field,
            detail: format!("must be 1-{max_len} non-whitespace characters"),
        });
    }
    Ok(value.to_string())
}

fn normalize_optional_token(
    value: Option<String>,
    field: &'static str,
    max_len: usize,
) -> Result<Option<String>, RegistryError> {
    value
        .map(|value| normalize_token(&value, field, max_len))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn declared_candidate(
        model: impl Into<String>,
        capabilities: impl IntoIterator<Item = ModelCapability>,
    ) -> DeclaredModelCandidate {
        let model = model.into();
        DeclaredModelCandidate {
            requested_model_id: model.clone(),
            provider: "test-provider".to_string(),
            concrete_model: Some(ConcreteModelIdentity {
                model_id: model,
                revision: Some("rev-1".to_string()),
            }),
            mutable_alias: false,
            family: Some("test-family".to_string()),
            size_class: Some("4b".to_string()),
            input_modalities: BTreeSet::from([ModelModality::Text]),
            output_modalities: BTreeSet::from([ModelModality::Text]),
            context_limit: Some(32_768),
            output_limit: Some(4_096),
            supported_parameters: SupportedParameters {
                structured_output: true,
                json_mode: true,
                tools: false,
                seed: true,
                stop: true,
            },
            data_policy: DataPolicyEligibility {
                retention: DataRetention::None,
                training: TrainingUse::Prohibited,
            },
            prompt_adapter: PromptAdapterRef {
                id: "cosy-chat".to_string(),
                version: "7".to_string(),
            },
            sampling: SamplingDefaults {
                temperature: Some(0.7),
                top_p: Some(0.9),
                seed: Some(42),
                stop: vec!["<END>".to_string()],
                hard_output_cap: 512,
            },
            capabilities: capabilities.into_iter().collect(),
            observations: CandidateObservations::default(),
        }
    }

    fn snapshot(
        version: &str,
        declared: Vec<DeclaredModelCandidate>,
        discovered: Vec<DiscoveredModelCandidate>,
    ) -> CapabilityRegistrySnapshot {
        CapabilityRegistrySnapshot::from_document(CapabilityRegistryDocument {
            schema_version: REGISTRY_SCHEMA_VERSION,
            snapshot_version: version.to_string(),
            declared,
            discovered,
        })
        .expect("valid registry snapshot")
    }

    #[test]
    fn catalog_addition_and_removal_create_new_immutable_snapshots() {
        let first = Arc::new(snapshot(
            "catalog-1",
            vec![declared_candidate(
                "provider/small",
                [ModelCapability::Voice],
            )],
            Vec::new(),
        ));
        let pinned = first
            .pin(
                ModelCapability::Voice,
                Some("provider/small"),
                DataPolicyMode::Production,
            )
            .expect("pin first snapshot");
        let second = snapshot(
            "catalog-2",
            vec![declared_candidate(
                "provider/large",
                [ModelCapability::Voice],
            )],
            Vec::new(),
        );

        assert_eq!(first.candidate_count(), 1);
        assert_eq!(second.candidate_count(), 1);
        assert!(second
            .pin(
                ModelCapability::Voice,
                Some("provider/small"),
                DataPolicyMode::Production
            )
            .is_err());
        assert_eq!(
            pinned
                .attribute_response(Some("provider/small"))
                .expect("pinned selection remains valid")
                .catalog_snapshot_version,
            "catalog-1"
        );
    }

    #[test]
    fn mutable_alias_requires_concrete_provider_attribution() {
        let mut alias = declared_candidate("provider/auto", [ModelCapability::Voice]);
        alias.mutable_alias = true;
        alias.concrete_model = None;
        let registry = snapshot("aliases-1", vec![alias], Vec::new());
        let pinned = registry
            .pin(
                ModelCapability::Voice,
                Some("provider/auto"),
                DataPolicyMode::Production,
            )
            .expect("pin alias");

        assert!(matches!(
            pinned.attribute_response(None),
            Err(RegistryError::AliasUnresolved { .. })
        ));
        assert!(matches!(
            pinned.attribute_response(Some("provider/auto")),
            Err(RegistryError::AliasUnresolved { .. })
        ));
        let attributed = pinned
            .attribute_response(Some("provider/concrete-2026-07-26"))
            .expect("concrete provider model");
        assert_eq!(attributed.requested_model_id, "provider/auto");
        assert_eq!(attributed.resolved_model_id, "provider/concrete-2026-07-26");
    }

    #[test]
    fn capability_pools_do_not_promote_voice_to_planning_authority() {
        let registry = snapshot(
            "caps-1",
            vec![declared_candidate(
                "provider/tiny",
                [ModelCapability::Voice],
            )],
            Vec::new(),
        );

        assert_eq!(registry.pool_len(ModelCapability::Voice), 1);
        assert_eq!(registry.pool_len(ModelCapability::IntentJson), 0);
        assert!(matches!(
            registry.pin(
                ModelCapability::IntentJson,
                Some("provider/tiny"),
                DataPolicyMode::Development
            ),
            Err(RegistryError::CapabilityMismatch { .. })
        ));
    }

    #[test]
    fn unvalidated_discovery_never_grants_eligibility() {
        let discovered = DiscoveredModelCandidate {
            requested_model_id: "provider/catalog-only".to_string(),
            provider: "test-provider".to_string(),
            concrete_model: None,
            family: Some("catalog-family".to_string()),
            size_class: Some("1b".to_string()),
            input_modalities: BTreeSet::from([ModelModality::Text]),
            output_modalities: BTreeSet::from([ModelModality::Text]),
            context_limit: Some(8_192),
            output_limit: Some(1_024),
            supported_parameters: SupportedParameters {
                json_mode: true,
                ..SupportedParameters::default()
            },
            reported_capabilities: BTreeSet::from([
                ModelCapability::Voice,
                ModelCapability::IntentJson,
            ]),
            observations: CandidateObservations::default(),
        };
        let registry = snapshot("discovery-1", Vec::new(), vec![discovered]);
        let candidate = registry
            .candidates
            .get("provider/catalog-only")
            .expect("discovered candidate remains inspectable");

        assert!(candidate.is_discovered());
        assert!(!candidate.is_declared());
        assert!(candidate.declared_capabilities().is_empty());
        assert_eq!(candidate.discovered_capabilities().len(), 2);
        assert_eq!(registry.pool_len(ModelCapability::Voice), 0);
    }

    #[test]
    fn production_privacy_policy_fails_closed() {
        let mut candidate = declared_candidate("provider/unknown-policy", [ModelCapability::Voice]);
        candidate.data_policy = DataPolicyEligibility::default();
        let registry = snapshot("privacy-1", vec![candidate], Vec::new());

        assert!(registry
            .pin(ModelCapability::Voice, None, DataPolicyMode::Development)
            .is_ok());
        let error = registry
            .pin(ModelCapability::Voice, None, DataPolicyMode::Production)
            .expect_err("unknown policy must fail closed");
        assert_eq!(error.code(), "inference_privacy_rejected");
    }

    #[test]
    fn configured_sampling_controls_require_declared_parameter_support() {
        let mut unsupported_seed = declared_candidate("provider/no-seed", [ModelCapability::Voice]);
        unsupported_seed.supported_parameters.seed = false;
        assert!(matches!(
            CapabilityRegistrySnapshot::from_document(CapabilityRegistryDocument {
                schema_version: REGISTRY_SCHEMA_VERSION,
                snapshot_version: "sampling-seed".to_string(),
                declared: vec![unsupported_seed],
                discovered: Vec::new(),
            }),
            Err(RegistryError::InvalidField {
                field: "sampling seed",
                ..
            })
        ));

        let mut unsupported_stop = declared_candidate("provider/no-stop", [ModelCapability::Voice]);
        unsupported_stop.supported_parameters.stop = false;
        assert!(matches!(
            CapabilityRegistrySnapshot::from_document(CapabilityRegistryDocument {
                schema_version: REGISTRY_SCHEMA_VERSION,
                snapshot_version: "sampling-stop".to_string(),
                declared: vec![unsupported_stop],
                discovered: Vec::new(),
            }),
            Err(RegistryError::InvalidField {
                field: "sampling stop",
                ..
            })
        ));
    }

    #[test]
    fn prompt_adapter_version_is_independent_from_model_identity() {
        let mut first = declared_candidate("provider/model", [ModelCapability::Voice]);
        first.prompt_adapter.version = "1".to_string();
        let mut second = first.clone();
        second.prompt_adapter.version = "2".to_string();
        let first = snapshot("adapter-1", vec![first], Vec::new())
            .pin(ModelCapability::Voice, None, DataPolicyMode::Production)
            .expect("first adapter")
            .attribute_response(None)
            .expect("first attribution");
        let second = snapshot("adapter-2", vec![second], Vec::new())
            .pin(ModelCapability::Voice, None, DataPolicyMode::Production)
            .expect("second adapter")
            .attribute_response(None)
            .expect("second attribution");

        assert_eq!(first.resolved_model_id, second.resolved_model_id);
        assert_ne!(first.prompt_adapter_version, second.prompt_adapter_version);
    }

    #[test]
    fn historical_unknown_models_remain_self_describing() {
        let old = snapshot(
            "old",
            vec![declared_candidate(
                "provider/retired",
                [ModelCapability::Voice],
            )],
            Vec::new(),
        )
        .pin(ModelCapability::Voice, None, DataPolicyMode::Production)
        .expect("old model")
        .attribute_response(None)
        .expect("old attribution");
        let serialized = serde_json::to_string(&old).expect("serialize attribution");
        let replayed =
            serde_json::from_str::<ModelAttribution>(&serialized).expect("replay attribution");
        let current = snapshot(
            "current",
            vec![declared_candidate(
                "provider/current",
                [ModelCapability::Voice],
            )],
            Vec::new(),
        );
        let inspected = current.inspect_historical(replayed);

        assert!(!inspected.known_in_current_snapshot);
        assert_eq!(inspected.attribution.requested_model_id, "provider/retired");
        assert_eq!(inspected.attribution.catalog_snapshot_version, "old");
        assert_eq!(inspected.attribution.prompt_adapter_version, "7");
    }

    #[test]
    fn registry_scales_without_expanding_a_generation_selection() {
        let candidates = (0..600)
            .map(|index| {
                declared_candidate(
                    format!("provider/model-{index:03}"),
                    [ModelCapability::Voice],
                )
            })
            .collect();
        let registry = snapshot("scale-600", candidates, Vec::new());
        let pinned = registry
            .pin(
                ModelCapability::Voice,
                Some("provider/model-517"),
                DataPolicyMode::Production,
            )
            .expect("pin one of hundreds");

        assert_eq!(registry.candidate_count(), 600);
        assert_eq!(registry.pool_len(ModelCapability::Voice), 600);
        assert_eq!(pinned.requested_model_id(), "provider/model-517");
        assert_eq!(
            pinned
                .attribute_response(None)
                .expect("one attribution")
                .resolved_model_id,
            "provider/model-517"
        );
    }
}
