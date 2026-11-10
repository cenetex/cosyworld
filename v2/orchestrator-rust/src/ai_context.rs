use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EvidenceScope {
    #[serde(rename = "self")]
    SelfActor,
    Relationship,
    Room,
    #[default]
    Location,
    World,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EvidenceVisibility {
    Private,
    Shared,
    #[default]
    Public,
    RevealedAfterEvent,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EvidenceSayability {
    InfluenceOnly,
    #[default]
    Disclosable,
    Sealed,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EvidenceVisuality {
    #[default]
    Visible,
    SubtextOnly,
    NeverRender,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ScopedKnowledge {
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) scope: EvidenceScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) owner_actor_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) shared_actor_ids: Vec<u64>,
    #[serde(default)]
    pub(crate) visibility: EvidenceVisibility,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) reveal_event: Option<String>,
    #[serde(default)]
    pub(crate) sayability: EvidenceSayability,
    #[serde(default)]
    pub(crate) visuality: EvidenceVisuality,
    #[serde(default = "default_salience")]
    pub(crate) salience: u8,
}

fn default_salience() -> u8 {
    50
}

impl ScopedKnowledge {
    pub(crate) fn validate(&self, label: &str) -> Result<(), String> {
        if self.text.trim().is_empty() || self.text.chars().count() > 500 {
            return Err(format!("{label} text must contain 1-500 characters"));
        }
        if self.salience > 100 {
            return Err(format!("{label} salience must be from 0 to 100"));
        }
        match self.visibility {
            EvidenceVisibility::Private if self.owner_actor_id.is_none() => {
                Err(format!("{label} private knowledge needs owner_actor_id"))
            }
            EvidenceVisibility::Shared if self.shared_actor_ids.is_empty() => {
                Err(format!("{label} shared knowledge needs shared_actor_ids"))
            }
            EvidenceVisibility::RevealedAfterEvent
                if self
                    .reveal_event
                    .as_deref()
                    .is_none_or(|event| event.trim().is_empty()) =>
            {
                Err(format!(
                    "{label} revealed_after_event knowledge needs reveal_event"
                ))
            }
            _ => Ok(()),
        }
    }
}

impl crate::RuntimeWorld {}
