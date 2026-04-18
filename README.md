- See todo.txt for my mental roadmap, mostly just notes
- Intended use is to copy src into your own project, or one of the examples
  - You should edit it directly to change things/add on, its best to keep it fast...
- This is my prefered balance between usability and performance
  - Easy to use CerealEntity api that interacts directly on entity/game memory
  - Could this be faster? Yes, but I wouldnt be sticking to pure js if that was the goal...
    - That said, if you are able to make clear improvments that dont hinder usability, make a pull request
    but keep in mind the below point
- The goal of this project was to make the fastest spatial and most usable entity system in js possible
  - This then has the upside of making network and p2p way easier and faster hence their inclusions
  - This ends up as a sort of "build your own" game engine/framework where expanding it is somewhat simple
  but you do not have to get in the weeds if you dont want to. Out of the box it should take care of mostly
  everything for you aside from actual game mechanics. But going beyond the built in APIS to make your own
  integrated ones could yeild signfigant results. 
  - In any case it is recommended to get an idea of how the engine works or mainly, where it doesnt...
- This engine is best suited for mega scale wars with entities of any size 
