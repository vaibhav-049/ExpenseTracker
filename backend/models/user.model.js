module.exports = (sequelize, Sequelize) => {
    const User = sequelize.define('user', {
        id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: Sequelize.STRING(100),
            allowNull: false
        },
        email: {
            type: Sequelize.STRING(100),
            allowNull: false,
            unique: true,
            validate: {
                isEmail: true
            }
        },
        password: {
            type: Sequelize.STRING(255),
            allowNull: false
        },
        budget: {
            type: Sequelize.DECIMAL(10, 2),
            defaultValue: 0
        }
    }, {
        timestamps: true,
        tableName: 'users'
    });

    return User;
};
