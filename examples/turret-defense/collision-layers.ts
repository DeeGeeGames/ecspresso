import { defineCollisionLayers } from "ecspresso/plugins/physics/collision";

const collisionLayers = defineCollisionLayers({
	turretProjectile: ['enemy'],
	enemy: ['turretProjectile'],
});

export default collisionLayers;
