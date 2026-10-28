"""Prepare the fixed cast once, then keep the speech path small."""
import hashlib
import json
import os
import pickle
from pathlib import Path


def profile_key(model_identity, reference):
    return hashlib.sha256(json.dumps([
        "nano-cpu-profiles-5de7a54-v1", model_identity,
        hashlib.sha256(Path(reference).read_bytes()).hexdigest(),
    ]).encode()).hexdigest()


def prepare_profiles(model, voices, voice_root, directory, model_identity):
    import torch
    from chatterbox.tts_turbo import Conditionals
    directory = Path(directory) / ".cosy-profiles"
    directory.mkdir(parents=True, exist_ok=True)
    profiles = {}
    prepared = 0
    for speaker, voice in voices.items():
        fresh = False
        reference = Path(voice_root) / voice["file"]
        path = directory / (profile_key(model_identity, reference) + ".pt")
        try:
            if not 0 < path.stat().st_size <= 4 * 1024 * 1024:
                raise ValueError("Refresh this voice profile.")
            profiles[speaker] = Conditionals.load(path, map_location="cpu").to("cpu")
        except (OSError, ValueError, KeyError, TypeError, RuntimeError, EOFError, pickle.UnpicklingError):
            with torch.inference_mode():
                model.prepare_conditionals(str(reference))
            profiles[speaker] = model.conds
            fresh = True
            prepared += 1
        profile = profiles[speaker]
        for name, value in vars(profile.t3).items():
            if torch.is_tensor(value):
                setattr(profile.t3, name, value.detach())
        for name, value in profile.gen.items():
            if torch.is_tensor(value):
                profile.gen[name] = value.detach()
        if fresh:
            temporary = path.with_suffix(f".{os.getpid()}.pending")
            profile.save(temporary)
            temporary.replace(path)
    return profiles, prepared


def release_reference_weights(model):
    import torch
    before = sum(p.numel() * p.element_size() for part in
                 (model.t3, model.s3gen, model.ve) for p in part.parameters())
    # The pinned S3Gen uses tokenizer.parameters() to read its device. During
    # speech it reads the prepared reference tensors supplied in ref_dict.
    anchor = torch.nn.Module()
    anchor.register_parameter("device_anchor", torch.nn.Parameter(
        torch.empty(0, device="cpu"), requires_grad=False))
    model.s3gen.tokenizer = anchor
    model.s3gen.speaker_encoder = None
    model.ve = None
    model.t3.text_head = None
    after = sum(p.numel() * p.element_size() for part in
                (model.t3, model.s3gen) for p in part.parameters())
    return before - after
