from helpers.extension import Extension
from helpers import skills
from tools.skills_tool import DATA_NAME_LOADED_SKILLS
from agent import LoopData


class IncludeLoadedSkills(Extension):
    async def execute(self, loop_data: LoopData = LoopData(), **kwargs):
        if not self.agent:
            return

        extras = loop_data.extras_persistent

        # Get loaded skills names
        skill_names = self.agent.data.get(DATA_NAME_LOADED_SKILLS)
        if not skill_names:
            return

        # load skill text here
        content = ""
        visible_skill_names = []
        for skill_name in skill_names:
            if not skills.find_skill(skill_name, agent=self.agent):
                continue
            visible_skill_names.append(skill_name)
            skill_data = skills.load_skill_for_agent(skill_name=skill_name, agent=self.agent)
            content += "\n\n" + skill_data
        self.agent.data[DATA_NAME_LOADED_SKILLS] = visible_skill_names
        content = content.strip()
        if not content:
            return


        # Inject into extras
        extras["loaded_skills"] = self.agent.read_prompt(
            "agent.system.skills.loaded.md",
            skills=content,
        )
