from pydantic import BaseModel
from typing import Dict, Any, Optional, List

class UserMessage(BaseModel):
    content: str
    thread_id: Optional[str] = None

class UserResponse(BaseModel):
    thread_id: str
    message: str

class JobRequest(BaseModel):
    input: Dict[str, Any]
    job_id: Optional[str] = None

class JobResponse(BaseModel):
    job_id: str
    status: str
    created_at: int