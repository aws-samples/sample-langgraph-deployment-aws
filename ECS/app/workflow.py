import asyncio
from typing import Annotated, List, Literal, Tuple, Dict, Any
from app.nodes import Nodes, State
from langgraph.graph import StateGraph, START, END

from langgraph.types import Command
from langgraph_checkpoint_dynamodb import (
    DynamoDBSaver,
    DynamoDBConfig,
    DynamoDBTableConfig,
)
from app.config import DEFAULT_REGION, DYNAMODB_TABLE


class Workflow:
    def __init__(self):
        config = DynamoDBConfig(
            table_config=DynamoDBTableConfig(
                table_name=DYNAMODB_TABLE,
            ),
            region_name=DEFAULT_REGION,
        )

        self.checkpointer = DynamoDBSaver(deploy=True, config=config)
        self.graph = self.build_graph()

    def build_graph(self):
        """Build the LangGraph workflow."""
        graph_builder = StateGraph(State)

        graph_builder.add_node(Nodes.outline_generator, "outline_generator")
        graph_builder.add_node(Nodes.writer, "writer")
        graph_builder.add_node(Nodes.formatter, "formatter")
        graph_builder.add_node(Nodes.human_feedback, "human_feedback")

        graph_builder.add_edge(START, "outline_generator")
        graph_builder.add_conditional_edges(
            "outline_generator",
            self.next_step,
        )
        graph_builder.add_edge("human_feedback", "outline_generator")
        graph_builder.add_edge("writer", "formatter")
        graph_builder.add_edge("formatter", END)

        return graph_builder.compile(checkpointer=self.checkpointer)

    def next_step(self, state) -> Literal["human_feedback", "writer"]:
        """Determine next step based on whether outline is approved."""
        return "writer" if state["human_approved"] else "human_feedback"

    def check_for_interrupt(self, state):
        """Check if workflow is waiting for human feedback."""
        if not state.tasks:
            return None

        task = state.tasks[0]

        if not task.interrupts:
            return None

        interrupt = task.interrupts[0]

        return interrupt.value if interrupt.value else None

    async def run_workflow(self, thread_id: str, user_msg: str) -> Dict[str, Any]:
        """Run the workflow with the given thread_id and user message."""
        config = {"configurable": {"thread_id": thread_id}}

        result = await self.invoke_graph(user_msg, thread_id)
        return result

    def get_current_state(self, thread_id: str):
        """Get the current state of the workflow for the given thread_id."""
        config = {"configurable": {"thread_id": thread_id}}
        return self.graph.get_state(config=config)

    async def invoke_graph(self, user_msg: str, thread_id: str):
        """Invoke the LangGraph workflow with appropriate resumption logic."""
        config = {"configurable": {"thread_id": thread_id}}

        current_state = await self.graph.aget_state(config=config)

        interrupt = self.check_for_interrupt(current_state)

        if interrupt:
            await self.graph.ainvoke(Command(resume=user_msg), config=config)
        elif current_state.next:
            await self.graph.ainvoke(None, config=config)
        else:
            await self.graph.ainvoke({"user_msg": user_msg}, config=config)

        current_state = await self.graph.aget_state(config=config)
        interrupt = self.check_for_interrupt(current_state)
        if interrupt:
            return interrupt
        else:
            return current_state.values.get("message_to_user", "Task completed")