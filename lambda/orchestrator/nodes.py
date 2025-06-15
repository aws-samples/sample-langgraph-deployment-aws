from typing import TypedDict
from langchain_aws import ChatBedrock
from prompts import (
    SYSTEM_PROMPT_FORMATTER,
    SYSTEM_PROMPT_OUTLINE_GENERATOR,
    SYSTEM_PROMPT_WRITER,
)
from langgraph.prebuilt import create_react_agent
from langchain_tavily import TavilySearch
from langchain_core.messages import HumanMessage, SystemMessage

from langgraph.types import interrupt


class State(TypedDict):
    user_msg: str
    human_approved: bool
    outline_messages: list[str]
    outline: str
    draft: str
    final_blog: str
    message_to_user: str


class Nodes:

    llm = ChatBedrock(
        model_id="anthropic.claude-3-5-sonnet-20241022-v2:0", region_name="us-west-2"
    )

    tools = [TavilySearch(max_results=3)]
    agent = create_react_agent(llm, tools=tools)

    @staticmethod
    async def outline_generator(state: State):

        if not state.get("outline_messages", ""):
            messages = [
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT_OUTLINE_GENERATOR,
                },
                {
                    "role": "user",
                    "content": state["user_msg"],
                },
            ]
        else:

            messages = state["outline_messages"]
            messages.append({"role": "user", "content": state["user_msg"]})

        result = Nodes.llm.invoke(messages)
        messages.append(result)

        outline = result.content.split("</outline>")[0].split("<outline>")[-1]
        human_approved = result.content.split("</human_approved>")[0].split(
            "<human_approved>"
        )[-1]

        human_approved = human_approved.lower().strip() == "true"

        return {
            "outline_messages": messages,
            "outline": outline,
            "human_approved": human_approved,
            "message_to_user": outline,
        }

    @staticmethod
    async def human_feedback(state: State):

        message_to_user = (
            f"Do you have any feedback on the blog outline:\n{state["outline"]}"
        )

        human_feedback = interrupt(message_to_user)

        return {
            "user_msg": human_feedback,
            "next": "outline_generator",
            "message_to_user": message_to_user,
        }

    @staticmethod
    async def writer(state: State):

        result = await Nodes.agent.ainvoke(
            {
                "messages": [
                    SystemMessage(SYSTEM_PROMPT_WRITER),
                    HumanMessage(f"The outline is:\n{state["outline"]}\n"),
                ]
            }
        )

        return {"draft": result["messages"][-1].content}

    @staticmethod
    async def formatter(state: State):

        result = await Nodes.llm.ainvoke(
            [
                SystemMessage(SYSTEM_PROMPT_FORMATTER),
                HumanMessage(state["draft"]),
            ]
        )

        return {"final_blog": result.content, "message_to_user": result.content}
