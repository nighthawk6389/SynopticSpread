from pydantic import BaseModel


class VerificationScore(BaseModel):
    model_name: str
    lead_hour: int
    mae: float
    bias: float
    n_samples: int


class VerificationResponse(BaseModel):
    variable: str
    lat: float
    lon: float
    scores: list[VerificationScore]
