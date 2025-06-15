import asyncio
import os
from typing import Annotated, List, Literal, Tuple
from nodes import Nodes, State
from langgraph.graph import StateGraph, START, END

from langgraph.types import Command
from langgraph_checkpoint_dynamodb import (
    DynamoDBSaver,
    DynamoDBConfig,
    DynamoDBTableConfig,
)


AWS_REGION = os.environ.get("AWS_REGION", "us-west-2")

class Workflow:

    def __init__(self):
        config = DynamoDBConfig(
            table_config=DynamoDBTableConfig(
                table_name="langgraph-state",
            ),
            region_name=AWS_REGION,
        )

        self.checkpointer = DynamoDBSaver(deploy=False, config=config)
        self.graph = self.build_graph()

    def build_graph(self):

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
        return "writer" if state["human_approved"] else "human_feedback"

    def check_for_interrupt(self, state):

        if state.tasks:
            if state.tasks[0].interrupts:
                if state.tasks[0].interrupts[0].value:
                    return state.tasks[0].interrupts[0].value

        return None

    async def invoke_graph(self, user_msg: str, thread_id: str):

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
            return current_state.values["message_to_user"]
